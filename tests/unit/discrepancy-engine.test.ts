import { describe, expect, it } from 'vitest';
import { identifyVendor, runDiscrepancyChecks } from '../../server/services/discrepancy-engine/index.ts';
import { scoreRisk } from '../../server/services/risk-scoring/index.ts';
import { baseInput, extraction, hist, lines, vendorA, vendorB } from './engine-fixtures.ts';

const names = (r: ReturnType<typeof runDiscrepancyChecks>) => r.findings.map((f) => f.rule_name);

describe('discrepancy engine', () => {
  it('returns no findings for a clean invoice', () => {
    const r = runDiscrepancyChecks(baseInput());
    expect(r.findings).toEqual([]);
    expect(r.vendor?.id).toBe('v-a');
  });

  it('detects an exact duplicate (same vendor + number + amount) and a previously paid match', () => {
    const input = baseInput({
      extraction: extraction({ invoice_number: 'inv-100', total_amount: 1500, subtotal: 1388.89, tax_amount: 111.11, line_items: [] }),
    });
    const r = runDiscrepancyChecks(input);
    expect(names(r)).toEqual(expect.arrayContaining(['duplicate', 'previously_paid_match']));
    const dup = r.findings.find((f) => f.rule_name === 'duplicate')!;
    expect(dup.related_record_id).toBe('h1');
    expect(dup.values_used_for_comparison.match_type).toBe('exact');
    expect(dup.evidence).toMatch(/Potential duplicate detected/);
    expect(r.related_invoices[0]).toMatchObject({ id: 'h1', paid: true });
  });

  it('does not flag the same invoice number when the amount is very different', () => {
    const r = runDiscrepancyChecks(baseInput({ extraction: extraction({ invoice_number: 'INV-100', total_amount: 99, subtotal: 91.67, tax_amount: 7.33, line_items: [] }) }));
    expect(names(r)).not.toContain('duplicate');
  });

  it('detects a near duplicate with a different invoice number', () => {
    const input = baseInput({
      invoices: [hist({ id: 'h9', invoice_number: 'INV-900', invoice_date: '2026-06-10', total_amount: 975, line_items: lines })],
      payments: [{ invoice_id: 'h9', status: 'paid' }],
    });
    const r = runDiscrepancyChecks(input);
    const dup = r.findings.find((f) => f.rule_name === 'duplicate')!;
    expect(dup.values_used_for_comparison.match_type).toBe('near');
    expect(names(r)).toContain('previously_paid_match');
    expect(scoreRisk(r.findings).level).toBe('high');
  });

  it('does not flag near duplicates when dates are far apart or lines differ', () => {
    const far = baseInput({ invoices: [hist({ id: 'h9', invoice_number: 'INV-900', invoice_date: '2026-03-01', total_amount: 975 })] });
    expect(names(runDiscrepancyChecks(far))).not.toContain('duplicate');
    const diffLines = baseInput({
      invoices: [hist({ id: 'h9', invoice_number: 'INV-900', invoice_date: '2026-06-12', total_amount: 975, line_items: [{ description: 'Quarterly window cleaning', quantity: 1, unit_price: 975, amount: 975 }] })],
    });
    expect(names(runDiscrepancyChecks(diffLines))).not.toContain('duplicate');
  });

  it('flags a duplicate without the paid rule when the match was never paid', () => {
    const input = baseInput({
      invoices: [hist({ id: 'h9', invoice_number: 'INV-900', invoice_date: '2026-06-10', total_amount: 975 })],
      payments: [],
    });
    const n = names(runDiscrepancyChecks(input));
    expect(n).toContain('duplicate');
    expect(n).not.toContain('previously_paid_match');
  });

  it('flags a bank mismatch against the verified vendor record', () => {
    const r = runDiscrepancyChecks(baseInput({ extraction: extraction({ bank_account_last4: '9999' }) }));
    const f = r.findings.find((x) => x.rule_name === 'bank_mismatch')!;
    expect(f.points).toBe(30);
    expect(f.values_used_for_comparison).toEqual({ invoice_bank_last4: '9999', verified_bank_last4: '4821' });
    expect(f.evidence).toMatch(/do not match the verified vendor record/);
  });

  it('does not flag bank mismatch when the invoice has no bank details', () => {
    const r = runDiscrepancyChecks(baseInput({ extraction: extraction({ bank_account_last4: null }) }));
    expect(names(r)).not.toContain('bank_mismatch');
  });

  it('flags a tax anomaly vs the approved rate', () => {
    const r = runDiscrepancyChecks(baseInput({ extraction: extraction({ tax_rate: 12, tax_amount: 108, total_amount: 1008 }) }));
    const f = r.findings.find((x) => x.rule_name === 'tax_anomaly')!;
    expect(f.points).toBe(15);
    expect(f.evidence).toMatch(/Tax rate differs from historical vendor behavior/);
  });

  it('uses the historic mode when the vendor has no approved rate', () => {
    const v = { ...vendorA, approved_tax_rate: null };
    const r = runDiscrepancyChecks(baseInput({ vendors: [v], extraction: extraction({ tax_rate: 5, tax_amount: 45, total_amount: 945 }) }));
    expect(names(r)).toContain('tax_anomaly');
  });

  it('flags a price anomaly at +25% or more over the historic average', () => {
    const high = extraction({ line_items: [{ description: 'Toner cartridge black', quantity: 5, unit_price: 140, amount: 700 }], subtotal: 700, tax_amount: 56, total_amount: 756 });
    const r = runDiscrepancyChecks(baseInput({ extraction: high }));
    const f = r.findings.find((x) => x.rule_name === 'price_anomaly')!;
    expect(f.points).toBe(15);
    expect((f.values_used_for_comparison.flagged_lines as Array<{ increase_pct: number }>)[0].increase_pct).toBe(40);
    const ok = extraction({ line_items: [{ description: 'Toner cartridge black', quantity: 5, unit_price: 110, amount: 550 }], subtotal: 550, tax_amount: 44, total_amount: 594 });
    expect(names(runDiscrepancyChecks(baseInput({ extraction: ok })))).not.toContain('price_anomaly');
  });

  it('does not flag prices with fewer than two historic samples', () => {
    const x = extraction({ line_items: [{ description: 'Brand new gadget', quantity: 1, unit_price: 9999, amount: 9999 }], subtotal: 9999, tax_amount: 799.92, total_amount: 10798.92 });
    expect(names(runDiscrepancyChecks(baseInput({ extraction: x })))).not.toContain('price_anomaly');
  });

  it('flags a missing PO, an over-PO invoice, and a PO issued to another vendor', () => {
    const missing = runDiscrepancyChecks(baseInput({ extraction: extraction({ purchase_order_number: 'PO-404' }) }));
    expect(missing.findings.find((f) => f.rule_name === 'po_mismatch')!.evidence).toMatch(/does not exist/);

    const po = { id: 'po1', po_number: 'PO-1', vendor_id: 'v-a', total_amount: 500 };
    const over = runDiscrepancyChecks(baseInput({ purchaseOrders: [po], extraction: extraction({ purchase_order_number: 'PO-1' }) }));
    expect(over.findings.find((f) => f.rule_name === 'po_mismatch')!.evidence).toMatch(/exceeds the PO total/);

    const other = runDiscrepancyChecks(baseInput({ purchaseOrders: [{ ...po, vendor_id: 'v-b', total_amount: 5000 }], extraction: extraction({ purchase_order_number: 'PO-1' }) }));
    expect(other.findings.find((f) => f.rule_name === 'po_mismatch')!.evidence).toMatch(/different vendor/);

    const fine = runDiscrepancyChecks(baseInput({ purchaseOrders: [{ ...po, total_amount: 5000 }], extraction: extraction({ purchase_order_number: 'PO-1' }) }));
    expect(names(fine)).not.toContain('po_mismatch');
  });

  it('flags arithmetic mismatches (subtotal + tax vs total, and line items vs subtotal)', () => {
    const a = runDiscrepancyChecks(baseInput({ extraction: extraction({ total_amount: 1000 }) }));
    expect(a.findings.find((f) => f.rule_name === 'arithmetic_mismatch')!.points).toBe(10);
    const b = runDiscrepancyChecks(baseInput({ extraction: extraction({ subtotal: 850, tax_amount: 68, total_amount: 918 }) }));
    expect(names(b)).toContain('arithmetic_mismatch');
    expect(names(runDiscrepancyChecks(baseInput({ extraction: extraction({ subtotal: 900.02, tax_amount: 72, total_amount: 972 }) })))).not.toContain('arithmetic_mismatch');
  });

  it('flags unknown and inactive vendors', () => {
    const unknown = runDiscrepancyChecks(baseInput({ extraction: extraction({ vendor_name: 'Totally Different Holdings' }) }));
    expect(unknown.vendor).toBeNull();
    expect(names(unknown)).toContain('unknown_vendor');
    const none = runDiscrepancyChecks(baseInput({ extraction: extraction({ vendor_name: null }) }));
    expect(none.findings[0].rule_name).toBe('unknown_vendor');
    const inactive = runDiscrepancyChecks(baseInput({ vendors: [{ ...vendorA, status: 'inactive' }] }));
    expect(inactive.findings.find((f) => f.rule_name === 'inactive_vendor')!.points).toBe(20);
  });

  it('matches near-identical vendor names with an informational (0 point) finding', () => {
    const r = runDiscrepancyChecks(baseInput({ extraction: extraction({ vendor_name: 'Apex Office Supply LLC' }) }));
    expect(r.vendor?.id).toBe('v-a');
    const f = r.findings.find((x) => x.rule_name === 'vendor_name_mismatch')!;
    expect(f.points).toBe(0);
  });

  it('reports similar vendor records', () => {
    const twin = { ...vendorB, id: 'v-twin', vendor_code: 'V099', legal_name: 'Apex Office Supplies Limited', display_name: 'Apex Office Supplies Ltd' };
    expect(identifyVendor('Apex Office Supplies LLC', [vendorA, twin]).vendor?.id).toBe('v-a');
    const r = runDiscrepancyChecks(baseInput({ vendors: [vendorA, twin] }));
    expect(names(r)).toContain('similar_vendor_names');
  });

  it('every finding carries the required fields', () => {
    const r = runDiscrepancyChecks(baseInput({ extraction: extraction({ bank_account_last4: '0000', tax_rate: 15, purchase_order_number: 'PO-X' }) }));
    for (const f of r.findings) {
      expect(f).toEqual(expect.objectContaining({ rule_name: expect.any(String), points: expect.any(Number), severity: expect.any(String), evidence: expect.any(String), values_used_for_comparison: expect.any(Object) }));
      expect(f).toHaveProperty('related_record_id');
    }
  });

  it('never throws on an extraction with all fields null', () => {
    const empty = extraction({ vendor_name: null, invoice_number: null, invoice_date: null, subtotal: null, tax_rate: null, tax_amount: null, total_amount: null, bank_account_last4: null, line_items: [] });
    expect(() => runDiscrepancyChecks(baseInput({ extraction: empty }))).not.toThrow();
  });
});
