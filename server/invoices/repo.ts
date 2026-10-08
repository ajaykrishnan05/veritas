import type { DB } from '../db/client.ts';
import type { HistoricInvoice, PaymentRecord, PurchaseOrderRecord, VendorRecord } from '../services/discrepancy-engine/index.ts';
import type { InvoiceStatus, ProcessingStage } from '../../src/types/index.ts';

export const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export interface InvoiceRow {
  id: string;
  source: string;
  uploaded_by: string | null;
  file_path: string | null;
  original_filename: string;
  mime_type: string;
  sha256: string | null;
  vendor_id: string | null;
  extracted_vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  subtotal: number | null;
  tax_rate: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  bank_account_last4: string | null;
  purchase_order_number: string | null;
  line_items: string;
  extraction_confidence: string | null;
  extraction_status: string;
  status: InvoiceStatus;
  processing_stage: ProcessingStage;
  processing_error: string | null;
  created_at: string;
}

export const getInvoice = (db: DB, id: string): InvoiceRow | undefined => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as InvoiceRow | undefined;

export function loadEngineContext(db: DB, excludeInvoiceId: string) {
  const vendors = db
    .prepare('SELECT id, vendor_code, legal_name, display_name, verified_bank_last4, approved_tax_rate, status FROM vendors')
    .all() as VendorRecord[];
  const invoices = (db.prepare("SELECT * FROM invoices WHERE id != ? AND status NOT IN ('processing','extraction_failed')").all(excludeInvoiceId) as InvoiceRow[]).map(
    (r): HistoricInvoice => ({
      id: r.id,
      vendor_id: r.vendor_id,
      invoice_number: r.invoice_number,
      invoice_date: r.invoice_date,
      tax_rate: r.tax_rate,
      total_amount: r.total_amount,
      purchase_order_number: r.purchase_order_number,
      line_items: parseJson(r.line_items, []),
      status: r.status,
    }),
  );
  const payments = db.prepare('SELECT invoice_id, status FROM payments').all() as PaymentRecord[];
  const purchaseOrders = db.prepare('SELECT id, po_number, vendor_id, total_amount FROM purchase_orders').all() as PurchaseOrderRecord[];
  return { vendors, invoices, payments, purchaseOrders };
}
