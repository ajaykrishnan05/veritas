import type { Explanation, InvoiceExtraction, RiskResult } from '../../../src/types/index.ts';
import type { AiProvider } from '../ai/provider.ts';
import { EXPLANATION_PROMPT, EXPLANATION_PROMPT_VERSION } from '../ai/prompts.ts';
import { explanationSchema } from '../ai/schemas.ts';
import type { AiTelemetry } from '../ai/telemetry.ts';
import { missingFields } from '../invoice-extraction/index.ts';

const ACTION_BY_LEVEL = { low: 'approve', medium: 'review', high: 'hold' } as const;
const SEVERITY_ORDER = { low: 0, medium: 1, high: 2 } as const;
const ACTION_RANK = { approve: 0, review: 1, hold: 2 } as const;

const VERIFICATION_BY_RULE: Record<string, string> = {
  duplicate: 'Confirm with the vendor and payment history that this is not a resubmission of an existing invoice.',
  previously_paid_match: 'Confirm whether the earlier payment already covered these goods or services.',
  bank_mismatch: 'Verify the new bank details with the vendor using a known phone number, not details from the invoice.',
  unknown_vendor: 'Verify the vendor through the onboarding process before any payment.',
  inactive_vendor: 'Confirm why an inactive vendor is invoicing and whether it should be reactivated.',
  tax_anomaly: 'Confirm the applicable tax rate with the vendor or tax team.',
  price_anomaly: 'Check for an approved price change or quote supporting the higher unit price.',
  po_mismatch: 'Confirm the purchase order reference and remaining PO balance with the requester.',
  arithmetic_mismatch: 'Request a corrected invoice or confirm the totals with the vendor.',
};

/** Deterministic explanation built only from findings; used when AI is unavailable or its output is rejected. */
export function deterministicExplanation(risk: RiskResult, extraction: InvoiceExtraction | null): Explanation {
  const scored = risk.triggered_rules.filter((f) => f.points > 0).sort((a, b) => b.points - a.points);
  const action = ACTION_BY_LEVEL[risk.level];
  const summary =
    risk.level === 'low'
      ? 'No significant discrepancies were found against vendor and payment history. Safe to approve.'
      : risk.level === 'medium'
        ? `Risk score ${risk.score}: ${scored.length} discrepanc${scored.length === 1 ? 'y' : 'ies'} need review before approval.`
        : `Score ${risk.score}: ${scored.length} discrepanc${scored.length === 1 ? 'y' : 'ies'} need verification before any payment is released.`;
  const reasons = (scored.length ? scored : risk.triggered_rules).slice(0, 4).map((f) => f.evidence);
  if (reasons.length === 0) reasons.push('Vendor, bank details, tax rate, prices and history are consistent with the records on file.');
  const missing = [...new Set(scored.map((f) => VERIFICATION_BY_RULE[f.rule_name]).filter(Boolean))].slice(0, 6);
  for (const f of missingFields(extraction ?? ({} as InvoiceExtraction))) missing.push(`Field "${f}" could not be read from the document.`);
  return { summary, reasons, recommended_action: action, missing_verification: missing };
}

export interface ExplanationOutcome {
  explanation: Explanation;
  telemetry: AiTelemetry;
}

/** AI may phrase the explanation but never changes the score; unsafe or invalid output falls back. */
export async function explainRisk(risk: RiskResult, extraction: InvoiceExtraction | null, provider: AiProvider | null): Promise<ExplanationOutcome> {
  const started = performance.now();
  const fallback = deterministicExplanation(risk, extraction);
  const base = (over: Partial<AiTelemetry>): AiTelemetry => ({
    operation: 'explanation',
    prompt_version: EXPLANATION_PROMPT_VERSION,
    model_name: provider?.model ?? 'deterministic-fallback',
    latency_ms: performance.now() - started,
    validation_status: 'fallback',
    error_message: null,
    input_metadata: { risk_level: risk.level, risk_score: risk.score, rules: risk.triggered_rules.map((f) => f.rule_name) },
    ...over,
  });

  if (!provider) return { explanation: fallback, telemetry: base({}) };

  try {
    const evidence = {
      risk_level: risk.level,
      risk_score: risk.score,
      findings: risk.triggered_rules.map((f) => ({ rule: f.rule_name, points: f.points, severity: f.severity, evidence: f.evidence, values: f.values_used_for_comparison })),
    };
    const raw = await provider.explain(EXPLANATION_PROMPT, evidence);
    const parsed = explanationSchema.safeParse(JSON.parse(raw.trim()));
    if (!parsed.success) throw new Error(`Explanation failed schema validation: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    // Never let the AI downgrade the recommendation below what the deterministic level requires.
    if (ACTION_RANK[parsed.data.recommended_action] < ACTION_RANK[ACTION_BY_LEVEL[risk.level]] && SEVERITY_ORDER[risk.level] > 0) {
      throw new Error('Explanation recommended a weaker action than the risk level requires');
    }
    return { explanation: parsed.data, telemetry: base({ validation_status: 'passed' }) };
  } catch (err) {
    return { explanation: fallback, telemetry: base({ validation_status: 'failed', error_message: err instanceof Error ? err.message : 'Unknown explanation error' }) };
  }
}
