// Types shared by the API (server/) and the React app (src/). No runtime code here.

export type Role = 'finance_operator' | 'chief_auditor';
export type RiskLevel = 'low' | 'medium' | 'high';
export type Severity = 'info' | 'low' | 'medium' | 'high';
export type DecisionAction = 'approve' | 'hold' | 'reject_duplicate' | 'reject_fraud';
export type InvoiceStatus = 'processing' | 'pending_review' | 'approved' | 'held' | 'rejected' | 'extraction_failed';
export type ProcessingStage = 'uploaded' | 'extracting' | 'comparing' | 'explaining' | 'done' | 'failed';
export type VendorStatus = 'active' | 'inactive' | 'pending';

export interface LineItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
}

export interface ExtractionConfidence {
  vendor_name: number;
  invoice_number: number;
  invoice_date: number;
  total_amount: number;
  tax_rate: number;
}

export interface InvoiceExtraction {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  subtotal: number | null;
  /** Percentage, e.g. 8.5 means 8.5% */
  tax_rate: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  bank_account_last4: string | null;
  purchase_order_number: string | null;
  line_items: LineItem[];
  confidence: ExtractionConfidence;
}

export interface Finding {
  rule_name: string;
  points: number;
  severity: Severity;
  /** Plain-language, carefully worded evidence. Never asserts fraud. */
  evidence: string;
  related_record_id: string | null;
  values_used_for_comparison: Record<string, unknown>;
}

export type WorkflowRequirement = 'operator_can_approve' | 'operator_review_required' | 'chief_auditor_required';

export interface RiskResult {
  score: number;
  level: RiskLevel;
  triggered_rules: Finding[];
  evidence: string[];
  workflow: WorkflowRequirement;
}

export interface Explanation {
  summary: string;
  reasons: string[];
  recommended_action: 'approve' | 'review' | 'hold';
  missing_verification: string[];
}

export interface SessionUser {
  id: string;
  full_name: string;
  email: string;
  role: Role;
}

export interface VendorView {
  id: string;
  vendor_code: string;
  legal_name: string;
  display_name: string;
  status: VendorStatus;
  verified_bank_last4: string | null;
  approved_tax_rate: number | null;
}

export interface DecisionView {
  id: string;
  invoice_id: string;
  action: DecisionAction;
  reviewer_note: string | null;
  reviewer_id: string;
  reviewer_name: string;
  created_at: string;
}

export interface InvoiceSummary {
  id: string;
  original_filename: string;
  vendor_id: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: number | null;
  status: InvoiceStatus;
  processing_stage: ProcessingStage;
  created_at: string;
  risk_score: number | null;
  risk_level: RiskLevel | null;
}

export interface InvoiceDetail {
  invoice: {
    id: string;
    original_filename: string;
    mime_type: string;
    extraction_status: string;
    extracted_vendor_name: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    subtotal: number | null;
    tax_rate: number | null;
    tax_amount: number | null;
    total_amount: number | null;
    bank_account_last4: string | null;
    purchase_order_number: string | null;
    line_items: LineItem[];
    extraction_confidence: ExtractionConfidence | null;
    status: InvoiceStatus;
    processing_stage: ProcessingStage;
    processing_error: string | null;
    created_at: string;
    uploaded_by_name: string | null;
  };
  vendor: VendorView | null;
  purchase_order: { po_number: string; total_amount: number; currency: string; status: string } | null;
  assessment: {
    risk_score: number;
    risk_level: RiskLevel;
    triggered_rules: Finding[];
    comparison_evidence: {
      evidence: string[];
      workflow: WorkflowRequirement;
      related_invoices: Array<{
        id: string;
        invoice_number: string | null;
        invoice_date: string | null;
        total_amount: number | null;
        status: string;
        paid: boolean;
      }>;
    };
    explanation: Explanation;
    created_at: string;
  } | null;
  decisions: DecisionView[];
  permissions: { allowed_actions: DecisionAction[]; blocked_reason: string | null };
}

export interface AuditRow {
  decision_id: string;
  invoice_id: string;
  vendor: string;
  invoice_number: string;
  amount: number | null;
  risk_score: number | null;
  risk_level: RiskLevel | null;
  triggered_rules: string[];
  decision: DecisionAction;
  reviewer: string;
  reviewer_note: string | null;
  timestamp: string;
}

export interface DashboardSummary {
  total_invoices: number;
  high_risk: number;
  pending_reviews: number;
  amount_at_risk: number;
  approved_amount: number;
  held_amount: number;
}
