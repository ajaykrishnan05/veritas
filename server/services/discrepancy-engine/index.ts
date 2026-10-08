import type { Finding, InvoiceExtraction, LineItem, VendorStatus } from '../../../src/types/index.ts';
import { RULE_WEIGHTS } from '../risk-scoring/index.ts';
import { daysBetween, money, normalizeKey, round2, similarity } from './text.ts';

export interface VendorRecord {
  id: string;
  vendor_code: string;
  legal_name: string;
  display_name: string;
  verified_bank_last4: string | null;
  approved_tax_rate: number | null;
  status: VendorStatus;
}

export interface HistoricInvoice {
  id: string;
  vendor_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  tax_rate: number | null;
  total_amount: number | null;
  purchase_order_number: string | null;
  line_items: LineItem[];
  status: string;
}

export interface PaymentRecord {
  invoice_id: string;
  status: 'paid' | 'pending' | 'cancelled';
}

export interface PurchaseOrderRecord {
  id: string;
  po_number: string;
  vendor_id: string;
  total_amount: number;
}

export interface EngineInput {
  invoiceId: string;
  extraction: InvoiceExtraction;
  vendors: VendorRecord[];
  /** Every other invoice on file (historic and previously uploaded). The engine filters to the vendor. */
  invoices: HistoricInvoice[];
  payments: PaymentRecord[];
  purchaseOrders: PurchaseOrderRecord[];
}

export interface RelatedInvoice {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: number | null;
  status: string;
  paid: boolean;
}

export interface EngineResult {
  vendor: VendorRecord | null;
  findings: Finding[];
  related_invoices: RelatedInvoice[];
}

// Thresholds (documented in README).
export const THRESHOLDS = {
  vendorMatch: 0.85,
  vendorCandidate: 0.6,
  amountTolerancePct: 0.02,
  exactAmountTolerancePct: 0.01,
  nearDuplicateDays: 14,
  lineSimilarity: 0.6,
  taxRateTolerancePts: 0.5,
  priceIncreasePct: 0.25,
  priceMatchSimilarity: 0.8,
  minPriceSamples: 2,
} as const;

const near = (a: number, b: number, pct: number, floor = 1): boolean => Math.abs(a - b) <= Math.max(floor, pct * Math.max(Math.abs(a), Math.abs(b)));

function finding(
  rule_name: string,
  points: number,
  severity: Finding['severity'],
  evidence: string,
  related_record_id: string | null,
  values: Record<string, unknown>,
): Finding {
  return { rule_name, points, severity, evidence, related_record_id, values_used_for_comparison: values };
}

/** Resolve the extracted vendor name to a vendor record. */
export function identifyVendor(
  name: string | null,
  vendors: VendorRecord[],
): { vendor: VendorRecord | null; exact: boolean; candidates: Array<{ vendor: VendorRecord; score: number }> } {
  if (!name || !normalizeKey(name)) return { vendor: null, exact: false, candidates: [] };
  const key = normalizeKey(name);
  const exactHits = vendors.filter((v) => normalizeKey(v.legal_name) === key || normalizeKey(v.display_name) === key);
  const scored = vendors
    .map((v) => ({ vendor: v, score: Math.max(similarity(name, v.legal_name), similarity(name, v.display_name)) }))
    .filter((c) => c.score >= THRESHOLDS.vendorCandidate)
    .sort((a, b) => b.score - a.score || a.vendor.vendor_code.localeCompare(b.vendor.vendor_code));
  if (exactHits.length > 0) {
    // Prefer an active record when several share an exact name.
    const best = [...exactHits].sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))[0];
    return { vendor: best, exact: true, candidates: scored };
  }
  const best = scored[0];
  if (best && best.score >= THRESHOLDS.vendorMatch) return { vendor: best.vendor, exact: false, candidates: scored };
  return { vendor: null, exact: false, candidates: scored };
}

export function lineSimilarity(a: LineItem[], b: LineItem[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const total = a.reduce((sum, la) => sum + Math.max(...b.map((lb) => similarity(la.description, lb.description))), 0);
  return total / a.length;
}

export function runDiscrepancyChecks(input: EngineInput): EngineResult {
  const { extraction: x } = input;
  const findings: Finding[] = [];
  const related: RelatedInvoice[] = [];
  const paidIds = new Set(input.payments.filter((p) => p.status === 'paid').map((p) => p.invoice_id));

  // 1. Vendor verification -------------------------------------------------
  const id = identifyVendor(x.vendor_name, input.vendors);
  const vendor = id.vendor;
  if (!vendor) {
    const hint = id.candidates[0];
    findings.push(
      finding(
        'unknown_vendor',
        RULE_WEIGHTS.unknown_vendor,
        'high',
        x.vendor_name
          ? `Vendor "${x.vendor_name}" was not found in the approved vendor list.${hint ? ` Closest record: "${hint.vendor.legal_name}" (${Math.round(hint.score * 100)}% name similarity), which is below the match threshold.` : ''}`
          : 'The vendor name could not be read from the document, so the vendor could not be verified.',
        hint?.vendor.id ?? null,
        { extracted_vendor_name: x.vendor_name, closest_vendor: hint?.vendor.legal_name ?? null, closest_similarity: hint ? round2(hint.score) : null },
      ),
    );
  } else {
    if (!id.exact) {
      findings.push(
        finding(
          'vendor_name_mismatch',
          0,
          'low',
          `Vendor name on the invoice ("${x.vendor_name}") is similar to, but not identical to, the vendor record "${vendor.legal_name}".`,
          vendor.id,
          { extracted_vendor_name: x.vendor_name, vendor_legal_name: vendor.legal_name },
        ),
      );
    }
    const others = id.candidates.filter((c) => c.vendor.id !== vendor.id && c.score >= THRESHOLDS.vendorMatch);
    if (others.length > 0) {
      findings.push(
        finding(
          'similar_vendor_names',
          0,
          'low',
          `Other vendor records have very similar names: ${others.map((o) => `"${o.vendor.legal_name}"`).join(', ')}. Confirm the correct payee.`,
          others[0].vendor.id,
          { matched_vendor: vendor.legal_name, similar_vendors: others.map((o) => o.vendor.legal_name) },
        ),
      );
    }
    if (vendor.status === 'inactive') {
      findings.push(
        finding('inactive_vendor', RULE_WEIGHTS.inactive_vendor, 'medium', `Vendor "${vendor.legal_name}" is marked inactive in the vendor master.`, vendor.id, { vendor_status: vendor.status }),
      );
    } else if (vendor.status === 'pending') {
      findings.push(
        finding('vendor_pending_verification', 0, 'low', `Vendor "${vendor.legal_name}" is still pending verification.`, vendor.id, { vendor_status: vendor.status }),
      );
    }
  }

  const vendorInvoices = vendor ? input.invoices.filter((i) => i.vendor_id === vendor.id && i.id !== input.invoiceId) : [];
  const historyWithTotals = vendorInvoices.filter((i) => i.total_amount != null && i.status !== 'extraction_failed' && i.status !== 'processing');

  // 2. Duplicate detection --------------------------------------------------
  if (vendor && x.total_amount != null) {
    const total = x.total_amount;
    const xNumber = x.invoice_number ? normalizeKey(x.invoice_number) : null;
    let flagged: { inv: HistoricInvoice; kind: 'exact' | 'near'; sim: number } | null = null;

    for (const inv of historyWithTotals) {
      const sim = lineSimilarity(x.line_items, inv.line_items);
      const sameNumber = xNumber != null && inv.invoice_number != null && normalizeKey(inv.invoice_number) === xNumber;
      let kind: 'exact' | 'near' | null = null;
      if (sameNumber && near(total, inv.total_amount!, THRESHOLDS.exactAmountTolerancePct)) {
        kind = 'exact';
      } else if (
        near(total, inv.total_amount!, THRESHOLDS.amountTolerancePct) &&
        x.invoice_date != null &&
        inv.invoice_date != null &&
        (daysBetween(x.invoice_date, inv.invoice_date) ?? Infinity) <= THRESHOLDS.nearDuplicateDays &&
        sim >= THRESHOLDS.lineSimilarity
      ) {
        kind = 'near';
      }
      if (!kind) continue;
      const better = !flagged || (kind === 'exact' && flagged.kind !== 'exact') || (kind === flagged.kind && sim > flagged.sim);
      if (better) flagged = { inv, kind, sim };
    }

    if (flagged) {
      const { inv, kind, sim } = flagged;
      const paid = paidIds.has(inv.id);
      related.push({ id: inv.id, invoice_number: inv.invoice_number, invoice_date: inv.invoice_date, total_amount: inv.total_amount, status: inv.status, paid });
      const values = {
        this_invoice_number: x.invoice_number,
        matched_invoice_number: inv.invoice_number,
        this_total: total,
        matched_total: inv.total_amount,
        this_date: x.invoice_date,
        matched_date: inv.invoice_date,
        line_item_similarity: round2(sim),
        matched_invoice_status: inv.status,
      };
      findings.push(
        finding(
          'duplicate',
          RULE_WEIGHTS.duplicate,
          'high',
          kind === 'exact'
            ? `Potential duplicate detected: the same vendor already has invoice ${inv.invoice_number} for ${money(inv.total_amount)} on file (status: ${inv.status}).`
            : `Potential duplicate detected: invoice ${inv.invoice_number} from the same vendor (${inv.invoice_date}) has a similar total (${money(inv.total_amount)} vs ${money(total)}), a similar date and ${Math.round(sim * 100)}% similar line items, but a different invoice number.`,
          inv.id,
          { match_type: kind, ...values },
        ),
      );
      if (paid) {
        findings.push(
          finding(
            'previously_paid_match',
            RULE_WEIGHTS.previously_paid_match,
            'high',
            `The matching invoice ${inv.invoice_number} has a recorded payment, so paying this invoice could result in a second payment for the same goods or services.`,
            inv.id,
            { matched_invoice_number: inv.invoice_number, matched_invoice_paid: true },
          ),
        );
      }
    }
  }

  // 3. Bank verification ----------------------------------------------------
  if (vendor && vendor.verified_bank_last4 && x.bank_account_last4 && vendor.verified_bank_last4 !== x.bank_account_last4) {
    findings.push(
      finding(
        'bank_mismatch',
        RULE_WEIGHTS.bank_mismatch,
        'high',
        `Payment details do not match the verified vendor record: invoice account ends in ${x.bank_account_last4}, verified account ends in ${vendor.verified_bank_last4}.`,
        vendor.id,
        { invoice_bank_last4: x.bank_account_last4, verified_bank_last4: vendor.verified_bank_last4 },
      ),
    );
  }

  // 4. Tax anomaly ------------------------------------------------------------
  const effectiveRate =
    x.tax_rate ?? (x.tax_amount != null && x.subtotal ? round2((x.tax_amount / x.subtotal) * 100) : null);
  if (vendor && effectiveRate != null) {
    const historicRates = vendorInvoices.map((i) => i.tax_rate).filter((r): r is number => r != null);
    const mode = (() => {
      const counts = new Map<number, number>();
      for (const r of historicRates) counts.set(r, (counts.get(r) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
    })();
    const reference = vendor.approved_tax_rate ?? mode;
    if (reference != null && Math.abs(effectiveRate - reference) > THRESHOLDS.taxRateTolerancePts) {
      findings.push(
        finding(
          'tax_anomaly',
          RULE_WEIGHTS.tax_anomaly,
          'medium',
          `Tax rate differs from historical vendor behavior: invoice shows ${effectiveRate}% but the ${vendor.approved_tax_rate != null ? 'approved' : 'historic'} rate for this vendor is ${reference}%.`,
          vendor.id,
          { invoice_tax_rate: effectiveRate, reference_tax_rate: reference, approved_tax_rate: vendor.approved_tax_rate, historic_rates: [...new Set(historicRates)].sort() },
        ),
      );
    }
  }

  // 5. Price anomaly ----------------------------------------------------------
  if (vendor && x.line_items.length > 0) {
    const groups: Array<{ description: string; prices: number[]; invoiceIds: string[] }> = [];
    for (const inv of vendorInvoices) {
      for (const li of inv.line_items) {
        const price = li.unit_price ?? (li.amount != null && li.quantity ? li.amount / li.quantity : null);
        if (price == null) continue;
        const g = groups.find((gr) => similarity(gr.description, li.description) >= THRESHOLDS.priceMatchSimilarity);
        if (g) {
          g.prices.push(price);
          g.invoiceIds.push(inv.id);
        } else groups.push({ description: li.description, prices: [price], invoiceIds: [inv.id] });
      }
    }
    const hits: Array<Record<string, unknown>> = [];
    for (const li of x.line_items) {
      const price = li.unit_price ?? (li.amount != null && li.quantity ? li.amount / li.quantity : null);
      if (price == null) continue;
      const g = groups
        .map((gr) => ({ gr, s: similarity(gr.description, li.description) }))
        .filter((c) => c.s >= THRESHOLDS.priceMatchSimilarity)
        .sort((a, b) => b.s - a.s)[0]?.gr;
      if (!g || g.prices.length < THRESHOLDS.minPriceSamples) continue;
      const avg = g.prices.reduce((a, b) => a + b, 0) / g.prices.length;
      if (price >= avg * (1 + THRESHOLDS.priceIncreasePct)) {
        hits.push({ description: li.description, invoice_unit_price: round2(price), historic_average_unit_price: round2(avg), increase_pct: Math.round((price / avg - 1) * 100), historic_samples: g.prices.length });
      }
    }
    if (hits.length > 0) {
      findings.push(
        finding(
          'price_anomaly',
          RULE_WEIGHTS.price_anomaly,
          'medium',
          `Line-item pricing is unusually high versus this vendor's history: ${hits
            .map((h) => `"${h.description}" is ${money(h.invoice_unit_price as number)} vs a historic average of ${money(h.historic_average_unit_price as number)} (+${h.increase_pct}%)`)
            .join('; ')}.`,
          vendor.id,
          { threshold_pct: THRESHOLDS.priceIncreasePct * 100, flagged_lines: hits },
        ),
      );
    }
  }

  // 6. Purchase-order mismatch ---------------------------------------------------
  if (x.purchase_order_number) {
    const po = input.purchaseOrders.find((p) => normalizeKey(p.po_number) === normalizeKey(x.purchase_order_number!));
    if (!po) {
      findings.push(
        finding('po_mismatch', RULE_WEIGHTS.po_mismatch, 'medium', `Referenced purchase order ${x.purchase_order_number} does not exist in the PO records.`, null, { referenced_po: x.purchase_order_number, po_found: false }),
      );
    } else {
      const problems: string[] = [];
      if (x.total_amount != null && x.total_amount > po.total_amount + 0.005) {
        problems.push(`invoice total ${money(x.total_amount)} exceeds the PO total ${money(po.total_amount)}`);
      }
      if (vendor && po.vendor_id !== vendor.id) problems.push('the PO was issued to a different vendor');
      if (problems.length > 0) {
        findings.push(
          finding('po_mismatch', RULE_WEIGHTS.po_mismatch, 'medium', `Purchase order ${po.po_number} mismatch: ${problems.join('; ')}.`, po.id, {
            po_number: po.po_number,
            po_total: po.total_amount,
            invoice_total: x.total_amount,
            po_vendor_matches: vendor ? po.vendor_id === vendor.id : null,
          }),
        );
      }
    }
  }

  // 7. Arithmetic -----------------------------------------------------------------
  const problems: string[] = [];
  const values: Record<string, unknown> = { subtotal: x.subtotal, tax_amount: x.tax_amount, total_amount: x.total_amount };
  if (x.subtotal != null && x.tax_amount != null && x.total_amount != null) {
    const expected = round2(x.subtotal + x.tax_amount);
    if (Math.abs(expected - x.total_amount) > Math.max(0.05, 0.001 * x.total_amount)) {
      problems.push(`subtotal ${money(x.subtotal)} + tax ${money(x.tax_amount)} = ${money(expected)}, but the invoice total is ${money(x.total_amount)}`);
      values.expected_total = expected;
    }
  }
  const lineAmounts = x.line_items.map((l) => l.amount);
  if (x.subtotal != null && lineAmounts.length > 0 && lineAmounts.every((a): a is number => a != null)) {
    const sum = round2(lineAmounts.reduce((a, b) => a + b, 0));
    if (Math.abs(sum - x.subtotal) > Math.max(0.05, 0.001 * x.subtotal)) {
      problems.push(`line items add up to ${money(sum)} but the subtotal is ${money(x.subtotal)}`);
      values.line_items_sum = sum;
    }
  }
  if (problems.length > 0) {
    findings.push(finding('arithmetic_mismatch', RULE_WEIGHTS.arithmetic_mismatch, 'low', `Arithmetic does not reconcile: ${problems.join('; ')}.`, null, values));
  }

  return { vendor, findings, related_invoices: related };
}
