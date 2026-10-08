import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBanner, Field, InfoBanner, PageHeader, RiskBadge, Spinner } from '../components/ui.tsx';
import { useAuth, useSessionGuard } from '../features/auth/AuthContext.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { ACTION_LABEL, dateTime, money, RULE_LABEL } from '../lib/format.ts';
import type { AuditRow } from '../types/index.ts';

interface Filters { q: string; risk: string; decision: string; from: string; to: string }
const EMPTY: Filters = { q: '', risk: '', decision: '', from: '', to: '' };

export default function AuditPage() {
  const { user } = useAuth();
  const guard = useSessionGuard();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();

  const load = useCallback(async () => {
    try {
      setError(null);
      setRows(await api.get<AuditRow[]>(`/audit?${qs}`));
    } catch (e) {
      guard(e);
      setError(errorMessage(e));
    }
  }, [qs, guard]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200); // debounce typing in search
    return () => clearTimeout(t);
  }, [load]);

  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const isAuditor = user?.role === 'chief_auditor';

  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle={isAuditor ? 'Every review decision across all invoices. Entries are append-only.' : 'Your review decisions. Chief Auditors can see and export all records.'}
        actions={isAuditor ? <a className="btn-primary" href={`/api/audit/export.csv${qs ? `?${qs}` : ''}`} download>Export CSV</a> : undefined}
      />
      {!isAuditor && <div className="mb-4"><InfoBanner>CSV export is available to the Chief Auditor role.</InfoBanner></div>}
      {error && <div className="mb-4"><ErrorBanner title="Could not load the audit trail">{error}</ErrorBanner></div>}

      <form className="card mb-6 grid grid-cols-2 gap-3 p-4 md:grid-cols-5" aria-label="Audit filters" onSubmit={(e) => e.preventDefault()}>
        <div className="col-span-2 md:col-span-1">
          <Field label="Search" htmlFor="a-q"><input id="a-q" type="search" className="input" placeholder="Vendor, invoice, reviewer, note" value={filters.q} onChange={set('q')} /></Field>
        </div>
        <Field label="Risk level" htmlFor="a-risk">
          <select id="a-risk" className="input" value={filters.risk} onChange={set('risk')}><option value="">All</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
        </Field>
        <Field label="Decision" htmlFor="a-dec">
          <select id="a-dec" className="input" value={filters.decision} onChange={set('decision')}>
            <option value="">All</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="From" htmlFor="a-from"><input id="a-from" type="date" className="input" value={filters.from} onChange={set('from')} /></Field>
        <Field label="To" htmlFor="a-to"><input id="a-to" type="date" className="input" value={filters.to} onChange={set('to')} /></Field>
      </form>

      <section className="card" aria-label="Audit records">
        {!rows && !error && <div className="p-6"><Spinner /></div>}
        {rows && rows.length === 0 && <p className="p-8 text-center text-sm text-slate-600">{Object.values(filters).some(Boolean) ? 'No records match these filters.' : 'No review decisions have been recorded yet.'}</p>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead><tr>
                <th className="th">Timestamp</th><th className="th">Invoice</th><th className="th">Vendor</th><th className="th text-right">Amount</th><th className="th">Risk</th>
                <th className="th">Triggered rules</th><th className="th">Decision</th><th className="th">Reviewer</th><th className="th">Note</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.decision_id}>
                    <td className="td whitespace-nowrap text-slate-600">{dateTime(r.timestamp)}</td>
                    <td className="td"><Link className="font-semibold text-primary hover:underline" to={`/invoices/${r.invoice_id}`}>{r.invoice_number || r.invoice_id.slice(0, 8)}</Link></td>
                    <td className="td">{r.vendor || '—'}</td>
                    <td className="td text-right tabular-nums">{money(r.amount)}</td>
                    <td className="td"><RiskBadge level={r.risk_level} score={r.risk_score} /></td>
                    <td className="td text-xs">{r.triggered_rules.length ? r.triggered_rules.map((x) => RULE_LABEL[x] ?? x).join(', ') : <span className="text-slate-500">None</span>}</td>
                    <td className="td font-semibold">{ACTION_LABEL[r.decision]}</td>
                    <td className="td">{r.reviewer}</td>
                    <td className="td max-w-xs whitespace-pre-wrap break-words text-slate-700">{r.reviewer_note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {rows && <p className="mt-2 text-xs text-slate-600">{rows.length} record{rows.length === 1 ? '' : 's'}</p>}
    </>
  );
}
