import { dateOnly, money } from '../../lib/format.ts';
import type { ExtractionConfidence, InvoiceDetail } from '../../types/index.ts';

function Confidence({ value }: { value: number | undefined }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  const pct = Math.round(value * 100);
  const low = value < 0.8;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded bg-slate-200" aria-hidden="true">
        <span className={`block h-full ${low ? 'bg-amber-500' : 'bg-green-600'}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`text-xs tabular-nums ${low ? 'font-semibold text-amber-800' : 'text-slate-600'}`}>{pct}%{low && ' · low'}</span>
    </span>
  );
}

export default function ExtractionPanel({ inv }: { inv: InvoiceDetail['invoice'] }) {
  const conf: Partial<ExtractionConfidence> = inv.extraction_confidence ?? {};
  const rows: Array<[string, string | null, keyof ExtractionConfidence | null]> = [
    ['Vendor name', inv.extracted_vendor_name, 'vendor_name'],
    ['Invoice number', inv.invoice_number, 'invoice_number'],
    ['Invoice date', inv.invoice_date ? dateOnly(inv.invoice_date) : null, 'invoice_date'],
    ['Subtotal', inv.subtotal == null ? null : money(inv.subtotal), null],
    ['Tax rate', inv.tax_rate == null ? null : `${inv.tax_rate}%`, 'tax_rate'],
    ['Tax amount', inv.tax_amount == null ? null : money(inv.tax_amount), null],
    ['Total', inv.total_amount == null ? null : money(inv.total_amount), 'total_amount'],
    ['Bank account (last 4)', inv.bank_account_last4 ? `•••• ${inv.bank_account_last4}` : null, null],
    ['Purchase order', inv.purchase_order_number, null],
  ];
  const missing = rows.filter(([, v]) => v == null).map(([l]) => l);
  return (
    <div className="space-y-5">
      {inv.extraction_status === 'partial' && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Some fields could not be read and were left empty rather than guessed: {missing.join(', ')}.</p>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Extracted invoice fields</caption>
          <thead><tr><th className="th">Field</th><th className="th">Value</th><th className="th">Confidence</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(([label, value, key]) => (
              <tr key={label}>
                <th scope="row" className="td font-medium text-slate-700">{label}</th>
                <td className="td">{value ?? <span className="italic text-slate-500">Not found</span>}</td>
                <td className="td">{key ? <Confidence value={conf[key]} /> : <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <h3 className="mb-2 text-sm font-semibold">Line items</h3>
        {inv.line_items.length === 0 ? <p className="text-sm italic text-slate-500">No line items were extracted.</p> : (
          <table className="min-w-full text-sm">
            <thead><tr><th className="th">Description</th><th className="th text-right">Qty</th><th className="th text-right">Unit price</th><th className="th text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {inv.line_items.map((l, i) => (
                <tr key={i}><td className="td">{l.description}</td><td className="td text-right tabular-nums">{l.quantity ?? '—'}</td><td className="td text-right tabular-nums">{money(l.unit_price)}</td><td className="td text-right tabular-nums">{money(l.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
