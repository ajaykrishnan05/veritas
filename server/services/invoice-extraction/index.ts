import type { InvoiceExtraction } from '../../../src/types/index.ts';
import type { AiDocument, AiProvider } from '../ai/provider.ts';
import { EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION } from '../ai/prompts.ts';
import { extractionSchema } from '../ai/schemas.ts';
import type { AiTelemetry } from '../ai/telemetry.ts';
import { DEMO_MARKER_PREFIX, demoByKey } from './demo-fixtures.ts';

export type ExtractionStatus = 'complete' | 'partial' | 'failed' | 'needs_manual_entry';

export interface ExtractionOutcome {
  extraction: InvoiceExtraction | null;
  status: ExtractionStatus;
  source: 'ai_provider' | 'demo_fixture' | 'none';
  error: string | null;
  telemetry: AiTelemetry;
}

const REQUIRED: Array<keyof InvoiceExtraction> = ['vendor_name', 'invoice_number', 'invoice_date', 'total_amount'];

export function emptyExtraction(): InvoiceExtraction {
  return {
    vendor_name: null, invoice_number: null, invoice_date: null, subtotal: null, tax_rate: null, tax_amount: null,
    total_amount: null, bank_account_last4: null, purchase_order_number: null, line_items: [],
    confidence: { vendor_name: 0, invoice_number: 0, invoice_date: 0, total_amount: 0, tax_rate: 0 },
  };
}

export function missingFields(x: InvoiceExtraction): string[] {
  return REQUIRED.filter((k) => x[k] == null).map(String);
}

/** Looks for the demo marker that seeded demo PDFs embed. Only used when no AI provider is configured. */
export function demoExtraction(bytes: Buffer): InvoiceExtraction | null {
  const text = bytes.toString('latin1');
  const i = text.indexOf(DEMO_MARKER_PREFIX);
  if (i < 0) return null;
  const key = /^[a-z0-9-]+/.exec(text.slice(i + DEMO_MARKER_PREFIX.length))?.[0];
  const fixture = key ? demoByKey(key) : undefined;
  return fixture ? structuredClone(fixture.extraction) : null;
}

/** Strict JSON parse (no markdown fences tolerated) followed by schema validation. */
export function parseExtraction(raw: string): InvoiceExtraction {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim());
  } catch {
    throw new Error('Model output was not valid JSON');
  }
  const parsed = extractionSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Model output failed schema validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

function statusFor(x: InvoiceExtraction): ExtractionStatus {
  return missingFields(x).length === 0 ? 'complete' : 'partial';
}

const confidenceSummary = (x: InvoiceExtraction | null) =>
  x ? Math.round((Object.values(x.confidence).reduce((a, b) => a + b, 0) / 5) * 100) / 100 : null;

/**
 * extractInvoice(document): Promise<InvoiceExtraction> — wrapped with status and telemetry.
 * With a provider: multimodal extraction, strictly validated. Without: demo-fixture fallback for seeded
 * documents only; any other document yields needs_manual_entry (we never guess values).
 */
export async function extractInvoice(doc: AiDocument & { filename: string }, provider: AiProvider | null): Promise<ExtractionOutcome> {
  const started = performance.now();
  const meta = { mime: doc.mime, size_bytes: doc.bytes.length };
  const telemetry = (over: Partial<AiTelemetry>, x: InvoiceExtraction | null): AiTelemetry => ({
    operation: 'extraction',
    prompt_version: EXTRACTION_PROMPT_VERSION,
    model_name: provider?.model ?? 'deterministic-demo-fallback',
    latency_ms: performance.now() - started,
    validation_status: 'passed',
    error_message: null,
    input_metadata: { ...meta, mean_confidence: confidenceSummary(x), missing_fields: x ? missingFields(x) : null },
    ...over,
  });

  if (provider) {
    try {
      const x = parseExtraction(await provider.extractInvoice(doc, EXTRACTION_PROMPT));
      return { extraction: x, status: statusFor(x), source: 'ai_provider', error: null, telemetry: telemetry({}, x) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown extraction error';
      return { extraction: null, status: 'failed', source: 'none', error: `Extraction failed: ${message}`, telemetry: telemetry({ validation_status: 'failed', error_message: message }, null) };
    }
  }

  const demo = demoExtraction(doc.bytes);
  if (demo) {
    return { extraction: demo, status: statusFor(demo), source: 'demo_fixture', error: null, telemetry: telemetry({ validation_status: 'fallback' }, demo) };
  }
  const message = 'No AI provider is configured and this is not a seeded demo document, so fields cannot be extracted automatically.';
  return { extraction: null, status: 'needs_manual_entry', source: 'none', error: message, telemetry: telemetry({ validation_status: 'fallback', error_message: message }, null) };
}
