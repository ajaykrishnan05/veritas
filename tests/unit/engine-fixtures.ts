import type { InvoiceExtraction } from '../../src/types/index.ts';
import type { EngineInput, HistoricInvoice, VendorRecord } from '../../server/services/discrepancy-engine/index.ts';

export const vendorA: VendorRecord = {
  id: 'v-a', vendor_code: 'V001', legal_name: 'Apex Office Supplies LLC', display_name: 'Apex Office Supplies',
  verified_bank_last4: '4821', approved_tax_rate: 8, status: 'active',
};
export const vendorB: VendorRecord = {
  id: 'v-b', vendor_code: 'V002', legal_name: 'Brightline Logistics Inc', display_name: 'Brightline',
  verified_bank_last4: '1177', approved_tax_rate: 6, status: 'active',
};

export const lines = [
  { description: 'Copy paper case (10 reams)', quantity: 10, unit_price: 40, amount: 400 },
  { description: 'Toner cartridge black', quantity: 5, unit_price: 100, amount: 500 },
];

export function hist(over: Partial<HistoricInvoice> & { id: string }): HistoricInvoice {
  return {
    vendor_id: 'v-a', invoice_number: 'INV-1', invoice_date: '2026-05-01', tax_rate: 8, total_amount: 972,
    purchase_order_number: null, line_items: lines, status: 'approved', ...over,
  };
}

export function extraction(over: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    vendor_name: 'Apex Office Supplies LLC', invoice_number: 'INV-NEW', invoice_date: '2026-06-20',
    subtotal: 900, tax_rate: 8, tax_amount: 72, total_amount: 972, bank_account_last4: '4821',
    purchase_order_number: null, line_items: lines,
    confidence: { vendor_name: 0.95, invoice_number: 0.95, invoice_date: 0.95, total_amount: 0.95, tax_rate: 0.9 },
    ...over,
  };
}

/** History: three clean past invoices at stable prices, one of which was paid. */
export function baseInput(over: Partial<EngineInput> = {}): EngineInput {
  return {
    invoiceId: 'new',
    extraction: extraction(),
    vendors: [vendorA, vendorB],
    invoices: [
      hist({ id: 'h1', invoice_number: 'INV-100', invoice_date: '2026-01-10', total_amount: 1500, line_items: [{ description: 'Copy paper case (10 reams)', quantity: 30, unit_price: 40, amount: 1200 }] }),
      hist({ id: 'h2', invoice_number: 'INV-101', invoice_date: '2026-02-10', total_amount: 800, line_items: [{ description: 'Toner cartridge black', quantity: 8, unit_price: 100, amount: 800 }] }),
      hist({ id: 'h3', invoice_number: 'INV-102', invoice_date: '2026-03-10', total_amount: 420, line_items: [{ description: 'Copy paper case (10 reams)', quantity: 5, unit_price: 41, amount: 205 }, { description: 'Toner cartridge black', quantity: 2, unit_price: 100, amount: 200 }] }),
    ],
    payments: [{ invoice_id: 'h1', status: 'paid' }],
    purchaseOrders: [],
    ...over,
  };
}
