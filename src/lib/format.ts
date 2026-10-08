import type { DecisionAction, InvoiceStatus, RiskLevel } from '../types/index.ts';

export const money = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export const dateTime = (iso: string): string => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
export const dateOnly = (iso: string | null): string => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '—');

export const RISK_LABEL: Record<RiskLevel, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  processing: 'Processing',
  pending_review: 'Pending review',
  approved: 'Approved',
  held: 'Held',
  rejected: 'Rejected',
  extraction_failed: 'Extraction failed',
};

export const ACTION_LABEL: Record<DecisionAction, string> = {
  approve: 'Approve',
  hold: 'Hold for investigation',
  reject_duplicate: 'Reject as duplicate',
  reject_fraud: 'Reject – suspected fraud',
};

export const RULE_LABEL: Record<string, string> = {
  duplicate: 'Potential duplicate',
  previously_paid_match: 'Matches a paid invoice',
  bank_mismatch: 'Bank details mismatch',
  unknown_vendor: 'Vendor not recognized',
  inactive_vendor: 'Inactive vendor',
  tax_anomaly: 'Tax rate anomaly',
  price_anomaly: 'Line-item price anomaly',
  po_mismatch: 'Purchase order mismatch',
  arithmetic_mismatch: 'Arithmetic mismatch',
  vendor_name_mismatch: 'Vendor name differs from record',
  similar_vendor_names: 'Similar vendor names',
  vendor_pending_verification: 'Vendor pending verification',
};
