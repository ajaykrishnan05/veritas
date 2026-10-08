PRAGMA foreign_keys = ON;

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('finance_operator','chief_auditor')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE vendors (
  id TEXT PRIMARY KEY,
  vendor_code TEXT NOT NULL UNIQUE,
  legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  tax_id TEXT,
  verified_bank_last4 TEXT CHECK (verified_bank_last4 IS NULL OR length(verified_bank_last4) = 4),
  approved_tax_rate REAL,
  status TEXT NOT NULL CHECK (status IN ('active','inactive','pending')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  total_amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','historic')),
  uploaded_by TEXT REFERENCES profiles(id),
  file_path TEXT,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  sha256 TEXT,
  vendor_id TEXT REFERENCES vendors(id),
  extracted_vendor_name TEXT,
  invoice_number TEXT,
  invoice_date TEXT,
  subtotal REAL,
  tax_rate REAL,
  tax_amount REAL,
  total_amount REAL,
  bank_account_last4 TEXT CHECK (bank_account_last4 IS NULL OR length(bank_account_last4) = 4),
  purchase_order_number TEXT,
  line_items TEXT NOT NULL DEFAULT '[]',
  extraction_confidence TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'processing',
  processing_stage TEXT NOT NULL DEFAULT 'uploaded',
  processing_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_invoices_vendor ON invoices(vendor_id);
CREATE INDEX idx_invoices_sha ON invoices(sha256);
CREATE INDEX idx_invoices_source ON invoices(source);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  amount_paid REAL NOT NULL,
  payment_date TEXT NOT NULL,
  bank_account_last4 TEXT CHECK (bank_account_last4 IS NULL OR length(bank_account_last4) = 4),
  status TEXT NOT NULL CHECK (status IN ('paid','pending','cancelled'))
);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

CREATE TABLE risk_assessments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high')),
  triggered_rules TEXT NOT NULL,
  comparison_evidence TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_risk_invoice ON risk_assessments(invoice_id);

CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  reviewer_id TEXT NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL CHECK (action IN ('approve','hold','reject_duplicate','reject_fraud')),
  reviewer_note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_decisions_invoice ON review_decisions(invoice_id);

CREATE TABLE ai_logs (
  id TEXT PRIMARY KEY,
  invoice_id TEXT REFERENCES invoices(id),
  request_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('extraction','explanation')),
  prompt_version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  input_metadata TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL
);

-- Append-only audit tables: block UPDATE and DELETE at the database level.
CREATE TRIGGER review_decisions_no_update BEFORE UPDATE ON review_decisions
BEGIN SELECT RAISE(ABORT, 'review_decisions is append-only'); END;
CREATE TRIGGER review_decisions_no_delete BEFORE DELETE ON review_decisions
BEGIN SELECT RAISE(ABORT, 'review_decisions is append-only'); END;
CREATE TRIGGER ai_logs_no_update BEFORE UPDATE ON ai_logs
BEGIN SELECT RAISE(ABORT, 'ai_logs is append-only'); END;
CREATE TRIGGER ai_logs_no_delete BEFORE DELETE ON ai_logs
BEGIN SELECT RAISE(ABORT, 'ai_logs is append-only'); END;
CREATE TRIGGER risk_assessments_no_update BEFORE UPDATE ON risk_assessments
BEGIN SELECT RAISE(ABORT, 'risk_assessments is append-only'); END;
CREATE TRIGGER risk_assessments_no_delete BEFORE DELETE ON risk_assessments
BEGIN SELECT RAISE(ABORT, 'risk_assessments is append-only'); END;
