import type { Finding, RiskLevel, RiskResult, WorkflowRequirement } from '../../../src/types/index.ts';

/** Fixed weights from the product spec. Rules without an entry here carry 0 points (informational). */
export const RULE_WEIGHTS = {
  duplicate: 40, // exact or near duplicate
  previously_paid_match: 40,
  bank_mismatch: 30,
  unknown_vendor: 25,
  inactive_vendor: 20,
  tax_anomaly: 15,
  price_anomaly: 15,
  po_mismatch: 15,
  arithmetic_mismatch: 10,
} as const;

export const SCORE_CAP = 100;

export function classifyRisk(score: number): RiskLevel {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

const WORKFLOW: Record<RiskLevel, WorkflowRequirement> = {
  low: 'operator_can_approve',
  medium: 'operator_review_required',
  high: 'chief_auditor_required',
};

/** Pure, deterministic. The AI layer never sees or alters this result. */
export function scoreRisk(findings: Finding[]): RiskResult {
  const raw = findings.reduce((sum, f) => sum + f.points, 0);
  const score = Math.min(SCORE_CAP, Math.max(0, raw));
  const level = classifyRisk(score);
  return {
    score,
    level,
    triggered_rules: findings,
    evidence: findings.map((f) => f.evidence),
    workflow: WORKFLOW[level],
  };
}
