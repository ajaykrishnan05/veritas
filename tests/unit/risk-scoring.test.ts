import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/types/index.ts';
import { RULE_WEIGHTS, classifyRisk, scoreRisk } from '../../server/services/risk-scoring/index.ts';

const f = (rule_name: string, points: number): Finding => ({ rule_name, points, severity: 'medium', evidence: `${rule_name} evidence`, related_record_id: null, values_used_for_comparison: {} });

describe('risk scoring', () => {
  it('uses the specified weights', () => {
    expect(RULE_WEIGHTS).toEqual({
      duplicate: 40, previously_paid_match: 40, bank_mismatch: 30, unknown_vendor: 25, inactive_vendor: 20,
      tax_anomaly: 15, price_anomaly: 15, po_mismatch: 15, arithmetic_mismatch: 10,
    });
  });

  it('classifies boundaries: 0-29 low, 30-59 medium, 60-100 high', () => {
    const cases: Array<[number, string]> = [[0, 'low'], [29, 'low'], [30, 'medium'], [59, 'medium'], [60, 'high'], [100, 'high']];
    for (const [score, level] of cases) expect(classifyRisk(score)).toBe(level);
  });

  it('sums points, returns triggered rules and evidence, and picks the workflow', () => {
    const r = scoreRisk([f('bank_mismatch', 30), f('tax_anomaly', 15)]);
    expect(r.score).toBe(45);
    expect(r.level).toBe('medium');
    expect(r.workflow).toBe('operator_review_required');
    expect(r.triggered_rules).toHaveLength(2);
    expect(r.evidence).toEqual(['bank_mismatch evidence', 'tax_anomaly evidence']);
  });

  it('caps the score at 100', () => {
    const r = scoreRisk([f('duplicate', 40), f('previously_paid_match', 40), f('bank_mismatch', 30)]);
    expect(r.score).toBe(100);
    expect(r.level).toBe('high');
    expect(r.workflow).toBe('chief_auditor_required');
  });

  it('is low risk with no findings and ignores zero-point informational findings', () => {
    expect(scoreRisk([]).level).toBe('low');
    const r = scoreRisk([f('vendor_name_mismatch', 0)]);
    expect(r.score).toBe(0);
    expect(r.workflow).toBe('operator_can_approve');
  });

  it('is deterministic', () => {
    const input = [f('duplicate', 40), f('tax_anomaly', 15)];
    expect(scoreRisk(input)).toEqual(scoreRisk(input));
  });
});
