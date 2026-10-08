import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/client.ts';
import { getInvoice, loadEngineContext } from '../../invoices/repo.ts';
import type { StorageProvider } from '../../storage/index.ts';
import type { ProcessingStage } from '../../../src/types/index.ts';
import type { AiProvider } from '../ai/provider.ts';
import { logAiOperation } from '../ai/telemetry.ts';
import { runDiscrepancyChecks } from '../discrepancy-engine/index.ts';
import { explainRisk } from '../explanation/index.ts';
import { extractInvoice } from '../invoice-extraction/index.ts';
import { scoreRisk } from '../risk-scoring/index.ts';

export interface PipelineDeps {
  db: DB;
  storage: StorageProvider;
  provider: AiProvider | null;
}

const setStage = (db: DB, id: string, stage: ProcessingStage) => db.prepare('UPDATE invoices SET processing_stage = ? WHERE id = ?').run(stage, id);

function fail(db: DB, id: string, message: string, extractionStatus?: string) {
  db.prepare("UPDATE invoices SET status = 'extraction_failed', processing_stage = 'failed', processing_error = ?, extraction_status = COALESCE(?, extraction_status) WHERE id = ?").run(message.slice(0, 500), extractionStatus ?? null, id);
}

/**
 * upload (already saved) → extract → validate → identify vendor → discrepancy checks → score → explain → persist.
 * Extraction and explanation are AI/fallback; discrepancy detection and scoring are deterministic code.
 */
export async function processInvoice({ db, storage, provider }: PipelineDeps, invoiceId: string): Promise<void> {
  const requestId = randomUUID();
  try {
    const inv = getInvoice(db, invoiceId);
    if (!inv || !inv.file_path) throw new Error('Invoice record or document not found');

    // 1. Extract + validate
    setStage(db, invoiceId, 'extracting');
    const bytes = await storage.read(inv.file_path);
    const ex = await extractInvoice({ bytes, mime: inv.mime_type, filename: inv.original_filename }, provider);
    logAiOperation(db, requestId, invoiceId, ex.telemetry);
    const x = ex.extraction;
    if (!x || (x.vendor_name == null && x.invoice_number == null && x.total_amount == null)) {
      return fail(db, invoiceId, ex.error ?? 'No invoice fields could be read from this document.', ex.status === 'complete' || ex.status === 'partial' ? 'failed' : ex.status);
    }

    // 2. Compare against trusted history (deterministic)
    setStage(db, invoiceId, 'comparing');
    const ctx = loadEngineContext(db, invoiceId);
    const result = runDiscrepancyChecks({ invoiceId, extraction: x, ...ctx });
    const risk = scoreRisk(result.findings);

    // 3. Explain (AI phrasing only; cannot change the score)
    setStage(db, invoiceId, 'explaining');
    const exp = await explainRisk(risk, x, provider);
    logAiOperation(db, requestId, invoiceId, exp.telemetry);

    // 4. Persist atomically
    db.transaction(() => {
      db.prepare(
        `UPDATE invoices SET vendor_id = ?, extracted_vendor_name = ?, invoice_number = ?, invoice_date = ?, subtotal = ?, tax_rate = ?, tax_amount = ?,
           total_amount = ?, bank_account_last4 = ?, purchase_order_number = ?, line_items = ?, extraction_confidence = ?, extraction_status = ?,
           status = 'pending_review', processing_stage = 'done', processing_error = NULL WHERE id = ?`,
      ).run(
        result.vendor?.id ?? null, x.vendor_name, x.invoice_number, x.invoice_date, x.subtotal, x.tax_rate, x.tax_amount, x.total_amount,
        x.bank_account_last4, x.purchase_order_number, JSON.stringify(x.line_items), JSON.stringify(x.confidence), ex.status, invoiceId,
      );
      db.prepare(
        `INSERT INTO risk_assessments (id, invoice_id, risk_score, risk_level, triggered_rules, comparison_evidence, explanation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(), invoiceId, risk.score, risk.level, JSON.stringify(risk.triggered_rules),
        JSON.stringify({ evidence: risk.evidence, workflow: risk.workflow, related_invoices: result.related_invoices }),
        JSON.stringify(exp.explanation), new Date().toISOString(),
      );
    })();
  } catch (err) {
    fail(db, invoiceId, err instanceof Error ? err.message : 'Unexpected processing error');
  }
}
