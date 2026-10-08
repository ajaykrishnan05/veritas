import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBanner, Field, PageHeader, RiskBadge, Spinner, StatusBadge } from '../components/ui.tsx';
import { useSessionGuard } from '../features/auth/AuthContext.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { dateOnly, money, STATUS_LABEL } from '../lib/format.ts';
import type { DashboardSummary, InvoiceSummary, VendorView } from '../types/index.ts';

interface Filters { risk: string; status: string; vendor: string; from: string; to: string }
const EMPTY: Filters = { risk: '', status: '', vendor: '', from: '', to: '' };

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'amber' | 'green' }) {
  const color = tone === 'red' ? 'text-red-800' : tone === 'amber' ? 'text-amber-800' : tone === 'green' ? 'text-green-800' : 'text-ink';
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const guard = useSessionGuard();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [vendors, setVendors] = useState<VendorView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    try {
      setError(null);
      const [s, list] = await Promise.all([api.get<DashboardSummary>(`/invoices/summary?${qs}`), api.get<InvoiceSummary[]>(`/invoices?${qs}`)]);
      setSummary(s);
      setInvoices(list);
    } catch (e) {
      guard(e);
      setError(errorMessage(e));
    }
  }, [filters, guard]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.get<VendorView[]>('/vendors').then(setVendors).catch(() => undefined); }, []);

  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Every uploaded invoice is checked against vendor and payment history before a decision."
        actions={<Link to="/upload" className="btn-primary">Upload invoice</Link>}
      />
      {error && <div className="mb-4"><ErrorBanner title="Could not load the dashboard">{error} <button className="underline" onClick={() => void load()}>Retry</button></ErrorBanner></div>}

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label="Invoices processed" value={summary ? String(summary.total_invoices) : '—'} />
        <Tile label="High risk" value={summary ? String(summary.high_risk) : '—'} tone="red" />
        <Tile label="Pending reviews" value={summary ? String(summary.pending_reviews) : '—'} tone="amber" />
        <Tile label="Amount at risk" value={summary ? money(summary.amount_at_risk) : '—'} tone="red" />
        <Tile label="Approved amount" value={summary ? money(summary.approved_amount) : '—'} tone="green" />
        <Tile label="Held amount" value={summary ? money(summary.held_amount) : '—'} tone="amber" />
      </section>
      <p className="mt-2 text-xs text-slate-600">“Amount at risk” is the total of medium- and high-risk invoices that are still pending review or held. No payments are executed by PayGuard.</p>

      <form className="card mt-6 grid grid-cols-2 gap-3 p-4 md:grid-cols-5" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Risk level" htmlFor="f-risk">
          <select id="f-risk" className="input" value={filters.risk} onChange={set('risk')}>
            <option value="">All</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </Field>
        <Field label="Status" htmlFor="f-status">
          <select id="f-status" className="input" value={filters.status} onChange={set('status')}>
            <option value="">All</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Vendor" htmlFor="f-vendor">
          <select id="f-vendor" className="input" value={filters.vendor} onChange={set('vendor')}>
            <option value="">All</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.display_name}</option>)}
          </select>
        </Field>
        <Field label="Uploaded from" htmlFor="f-from"><input id="f-from" type="date" className="input" value={filters.from} onChange={set('from')} /></Field>
        <Field label="Uploaded to" htmlFor="f-to"><input id="f-to" type="date" className="input" value={filters.to} onChange={set('to')} /></Field>
        {filtered && <div className="col-span-2 md:col-span-5"><button type="button" className="btn-secondary" onClick={() => setFilters(EMPTY)}>Clear filters</button></div>}
      </form>

      <section className="card mt-6" aria-label="Recent invoices">
        <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold">Recent invoices</h2>
        {!invoices && !error && <div className="p-6"><Spinner /></div>}
        {invoices && invoices.length === 0 && (
          <div className="p-8 text-center">
            <p className="font-semibold">{filtered ? 'No invoices match these filters.' : 'No invoices have been processed yet.'}</p>
            {!filtered && (
              <>
                <p className="mt-1 text-sm text-slate-600">Upload an invoice, or process one of the built-in demo documents.</p>
                <Link to="/upload" className="btn-primary mt-4">Upload invoice</Link>
              </>
            )}
          </div>
        )}
        {invoices && invoices.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead><tr><th className="th">Vendor</th><th className="th">Invoice</th><th className="th text-right">Amount</th><th className="th">Risk</th><th className="th">Status</th><th className="th">Uploaded</th><th className="th"><span className="sr-only">Action</span></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="td font-medium">{i.vendor_name ?? <span className="text-slate-500">Unknown</span>}</td>
                    <td className="td">{i.invoice_number ?? <span className="text-slate-500">{i.original_filename}</span>}</td>
                    <td className="td text-right tabular-nums">{money(i.total_amount)}</td>
                    <td className="td"><RiskBadge level={i.risk_level} score={i.risk_score} /></td>
                    <td className="td"><StatusBadge status={i.status} /></td>
                    <td className="td whitespace-nowrap text-slate-600">{dateOnly(i.created_at)}</td>
                    <td className="td text-right"><Link to={`/invoices/${i.id}`} className="font-semibold text-primary hover:underline">Review<span className="sr-only"> {i.invoice_number ?? i.original_filename}</span></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
