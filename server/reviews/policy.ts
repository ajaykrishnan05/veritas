import { ApiError } from '../http-error.ts';
import type { DecisionAction, InvoiceStatus, RiskLevel, Role } from '../../src/types/index.ts';

const ALL_ACTIONS: DecisionAction[] = ['approve', 'hold', 'reject_duplicate', 'reject_fraud'];
const OPERATOR_ACTIONS: DecisionAction[] = ['approve', 'hold', 'reject_duplicate'];
export const OPEN_STATUSES: InvoiceStatus[] = ['pending_review', 'held'];

export interface Permissions {
  allowed_actions: DecisionAction[];
  blocked_reason: string | null;
}

/**
 * Who may do what. Single source of truth for both the API check and the UI's button state.
 * - High risk: Chief Auditor only.
 * - Low/medium risk: Finance Operator may approve, hold or reject as duplicate; "reject – suspected fraud" is Chief Auditor only.
 */
export function permissionsFor(role: Role, level: RiskLevel | null, status: InvoiceStatus): Permissions {
  if (!level) return { allowed_actions: [], blocked_reason: 'This invoice has not been risk-assessed yet.' };
  if (!OPEN_STATUSES.includes(status)) {
    return { allowed_actions: [], blocked_reason: status === 'processing' ? 'This invoice is still being processed.' : `This invoice is already ${status}; decisions are final.` };
  }
  if (role === 'chief_auditor') return { allowed_actions: ALL_ACTIONS, blocked_reason: null };
  if (level === 'high') {
    return { allowed_actions: [], blocked_reason: 'High-risk invoices can only be resolved by a Chief Auditor.' };
  }
  return { allowed_actions: OPERATOR_ACTIONS, blocked_reason: null };
}

export function validateDecision(role: Role, level: RiskLevel | null, status: InvoiceStatus, action: DecisionAction, note: string | null): void {
  const perms = permissionsFor(role, level, status);
  if (!perms.allowed_actions.includes(action)) {
    const forbidden = perms.blocked_reason?.includes('already') || perms.blocked_reason?.includes('processed') || perms.blocked_reason?.includes('processing');
    throw new ApiError(forbidden ? 409 : 403, forbidden ? 'invoice_not_open' : 'forbidden', perms.blocked_reason ?? 'Your role is not permitted to take this action on this invoice.');
  }
  const noteRequired = action !== 'approve' || level !== 'low';
  if (noteRequired && !note) {
    throw new ApiError(400, 'note_required', action === 'approve' ? 'A reviewer note is required to approve a medium- or high-risk invoice.' : 'A reviewer note is required for hold and reject decisions.');
  }
}
