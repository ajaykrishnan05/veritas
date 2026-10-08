import type { InvoiceExtraction } from '../../../src/types/index.ts';

/**
 * Deterministic extraction results for the seeded demo documents. Each demo PDF embeds the marker
 * `PAYGUARD-DEMO:<key>`; when no AI provider is configured the fallback extractor looks the key up here.
 * Values are authored to match scripts/seed (vendor master, history, POs) so each scenario is reproducible.
 */
export interface DemoInvoice {
  key: string;
  filename: string;
  title: string;
  scenario: string;
  expected: { level: 'low' | 'medium' | 'high'; action: string };
  extraction: InvoiceExtraction;
}

const conf = (v = 0.97) => ({ vendor_name: v, invoice_number: v, invoice_date: v, total_amount: v, tax_rate: v - 0.04 });

export const DEMO_INVOICES: DemoInvoice[] = [
  {
    key: 'normal',
    filename: 'demo-1-normal-apex.pdf',
    title: 'Apex Office Supplies — routine order',
    scenario: 'Known vendor, matching bank suffix, normal tax and prices, no duplicate.',
    expected: { level: 'low', action: 'Approve' },
    extraction: {
      vendor_name: 'Apex Office Supplies LLC', invoice_number: 'INV-APX-7001', invoice_date: '2026-06-22',
      subtotal: 1236, tax_rate: 8, tax_amount: 98.88, total_amount: 1334.88, bank_account_last4: '4821', purchase_order_number: null,
      line_items: [
        { description: 'Copy paper case (10 reams)', quantity: 20, unit_price: 42.5, amount: 850 },
        { description: 'Toner cartridge, black', quantity: 4, unit_price: 96.5, amount: 386 },
      ],
      confidence: conf(),
    },
  },
  {
    key: 'duplicate',
    filename: 'demo-2-duplicate-brightline.pdf',
    title: 'Brightline Logistics — resubmitted invoice',
    scenario: 'Same lines and total as a paid June invoice, but a different invoice number.',
    expected: { level: 'high', action: 'Reject as duplicate (Chief Auditor)' },
    extraction: {
      vendor_name: 'Brightline Logistics Inc', invoice_number: 'BL-3302A', invoice_date: '2026-06-09',
      subtotal: 1700, tax_rate: 6, tax_amount: 102, total_amount: 1802, bank_account_last4: '1177', purchase_order_number: null,
      line_items: [
        { description: 'Pallet freight, regional', quantity: 6, unit_price: 185, amount: 1110 },
        { description: 'Last-mile delivery, per stop', quantity: 40, unit_price: 14.75, amount: 590 },
      ],
      confidence: conf(0.94),
    },
  },
  {
    key: 'bank-mismatch',
    filename: 'demo-3-bank-mismatch-cobalt.pdf',
    title: 'Cobalt IT Services — new bank details',
    scenario: 'Bank account suffix differs from the verified record; also above PO and higher rates.',
    expected: { level: 'high', action: 'Hold for investigation (Chief Auditor)' },
    extraction: {
      vendor_name: 'Cobalt IT Services Ltd', invoice_number: 'INV-CIT-5120', invoice_date: '2026-06-18',
      subtotal: 2680, tax_rate: 7.5, tax_amount: 201, total_amount: 2881, bank_account_last4: '5512', purchase_order_number: 'PO-2026-0003',
      line_items: [
        { description: 'Managed IT support, per seat-month', quantity: 25, unit_price: 88, amount: 2200 },
        { description: 'Network switch configuration', quantity: 2, unit_price: 240, amount: 480 },
      ],
      confidence: conf(0.92),
    },
  },
  {
    key: 'tax-price-anomaly',
    filename: 'demo-4-anomaly-delta.pdf',
    title: 'Delta Facility Maintenance — tax and price anomaly',
    scenario: 'Tax rate above the approved rate, an unusually high call-out price, and an unknown PO.',
    expected: { level: 'medium', action: 'Review or hold' },
    extraction: {
      vendor_name: 'Delta Facility Maintenance Co', invoice_number: 'INV-DFM-8841', invoice_date: '2026-06-19',
      subtotal: 1820, tax_rate: 11, tax_amount: 200.2, total_amount: 2020.2, bank_account_last4: '2290', purchase_order_number: 'PO-2026-9999',
      line_items: [
        { description: 'Monthly HVAC inspection', quantity: 2, unit_price: 310, amount: 620 },
        { description: 'Emergency plumbing call-out', quantity: 3, unit_price: 400, amount: 1200 },
      ],
      confidence: conf(0.9),
    },
  },
  {
    key: 'legit-unusual',
    filename: 'demo-5-unusual-evergreen.pdf',
    title: 'Evergreen Printing — legitimate unusual invoice',
    scenario: 'PO-backed, matching bank, no duplicate. Lower tax rate and a price-list increase are flagged for review, not treated as fraud.',
    expected: { level: 'medium', action: 'Review, then approve with a note' },
    extraction: {
      vendor_name: 'Evergreen Printing Group', invoice_number: 'INV-EVG-2208', invoice_date: '2026-06-17',
      subtotal: 2652, tax_rate: 5, tax_amount: 132.6, total_amount: 2784.6, bank_account_last4: '6643', purchase_order_number: 'PO-2026-0005',
      line_items: [
        { description: 'Large-format banner', quantity: 12, unit_price: 116, amount: 1392 },
        { description: 'Brochure print run (1,000 units)', quantity: 3, unit_price: 420, amount: 1260 },
      ],
      confidence: conf(0.95),
    },
  },
];

export const DEMO_MARKER_PREFIX = 'PAYGUARD-DEMO:';
export const demoByKey = (key: string): DemoInvoice | undefined => DEMO_INVOICES.find((d) => d.key === key);
