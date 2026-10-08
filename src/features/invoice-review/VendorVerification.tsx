import { Link } from 'react-router-dom';
import { dateOnly, money } from '../../lib/format.ts';
import type { InvoiceDetail } from '../../types/index.ts';

function Compare({ label, verified, invoice, format = (v: string | number) => String(v) }: { label: string; verified: string | number | null | undefined; invoice: string | number | null | undefined; format?: (v: string | number) => string }) {
  const known = verified != null && invoice != null;
  const match = known && String(verified) === String(invoice);
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</h4>
        {known && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${match ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'}`}>{match ? '✓ Match' : '▲ Mismatch'}</span>}
        {!known && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">Cannot compare</span>}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-xs text-slate-600">Verified record</dt><dd className="font-mono font-semibold">{verified != null ? format(verified) : '—'}</dd></div>
        <div><dt className="text-xs text-slate-600">On invoice</dt><dd className="font-mono font-semibold">{invoice != null ? format(invoice) : '—'}</dd></div>
      </dl>
    </div>
  );
}

export default function VendorVerification({ d }: { d: InvoiceDetail }) {
  const { vendor, invoice: inv, purchase_order: po, assessment } = d;
  const related = assessment?.comparison_evidence.related_invoices ?? [];
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Vendor verification</h3>
        {vendor ? (
          <p className="mt-1 text-sm">
            <span className="font-semibold">{vendor.legal_name}</span> ({vendor.vendor_code}) ·{' '}
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${vendor.status === 'active' ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'}`}>{vendor.status}</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-red-800">No matching vendor in the approved vendor list{inv.extracted_vendor_name ? ` for “${inv.extracted_vendor_name}”` : ''}.</p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Compare label="Bank account (last 4)" verified={vendor?.verified_bank_last4} invoice={inv.bank_account_last4} format={(v) => `•••• ${v}`} />
        <Compare label="Tax rate" verified={vendor?.approved_tax_rate} invoice={inv.tax_rate} format={(v) => `${v}%`} />
      </div>
      {inv.purchase_order_number && (
        <div className="rounded-md border border-slate-200 p-3 text-sm">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Purchase order {inv.purchase_order_number}</h4>
          {po ? <p className="mt-1">PO total {money(po.total_amount)} · invoice total {money(inv.total_amount)} {inv.total_amount != null && inv.total_amount > po.total_amount ? <strong className="text-red-800">(exceeds PO)</strong> : <span className="text-green-800">(within PO)</span>}</p> : <p className="mt-1 text-red-800">This purchase order does not exist in the PO records.</p>}
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold">Historic comparison</h3>
        {related.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">No duplicate or near-duplicate invoice was found in this vendor’s history.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr><th className="th">Matching invoice</th><th className="th">Date</th><th className="th text-right">Total</th><th className="th">Payment</th></tr></thead>
              <tbody>
                {related.map((r) => (
                  <tr key={r.id}>
                    <td className="td font-medium">{r.invoice_number}</td><td className="td">{dateOnly(r.invoice_date)}</td><td className="td text-right tabular-nums">{money(r.total_amount)}</td>
                    <td className="td">{r.paid ? <span className="font-semibold text-red-800">Paid</span> : r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-600">This invoice: {inv.invoice_number} · {dateOnly(inv.invoice_date)} · {money(inv.total_amount)}</p>
          </div>
        )}
        {vendor && <p className="mt-2 text-xs text-slate-500">Compared against all invoices and payments on file for this vendor. <Link to="/audit" className="underline">View audit trail</Link></p>}
      </div>
    </div>
  );
}
