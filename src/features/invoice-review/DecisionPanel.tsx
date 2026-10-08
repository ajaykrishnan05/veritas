import { useState } from 'react';
import { useSessionGuard } from '../auth/AuthContext.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { ACTION_LABEL } from '../../lib/format.ts';
import { ErrorBanner, InfoBanner } from '../../components/ui.tsx';
import type { DecisionAction, InvoiceDetail } from '../../types/index.ts';

const BTN: Record<DecisionAction, string> = { approve: 'btn-success', hold: 'btn-warn', reject_duplicate: 'btn-danger', reject_fraud: 'btn-danger' };
const ORDER: DecisionAction[] = ['approve', 'hold', 'reject_duplicate', 'reject_fraud'];

export default function DecisionPanel({ d, onDone }: { d: InvoiceDetail; onDone: () => void }) {
  const guard = useSessionGuard();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<DecisionAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { allowed_actions, blocked_reason } = d.permissions;
  const level = d.assessment?.risk_level;

  async function submit(action: DecisionAction) {
    setError(null);
    const noteRequired = action !== 'approve' || level !== 'low';
    if (noteRequired && !note.trim()) {
      setError(action === 'approve' ? 'Add a reviewer note to approve a medium- or high-risk invoice.' : 'Add a reviewer note explaining this hold or rejection.');
      return;
    }
    setBusy(action);
    try {
      await api.post(`/invoices/${d.invoice.id}/decisions`, { action, note: note.trim() || null });
      setSaved(ACTION_LABEL[action]);
      setNote('');
      onDone();
    } catch (e) {
      guard(e);
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card p-5" aria-labelledby="decision-heading">
      <h2 id="decision-heading" className="text-lg font-bold">Decision</h2>
      <p className="mt-1 text-xs text-slate-600">Recording a decision does not move money. PayGuard never executes payments.</p>
      {saved && <div className="mt-3"><InfoBanner>Decision recorded: <strong>{saved}</strong>. It has been added to the audit trail.</InfoBanner></div>}
      {error && <div className="mt-3"><ErrorBanner title="Decision not recorded">{error}</ErrorBanner></div>}

      {allowed_actions.length === 0 ? (
        <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm" role="note">{blocked_reason}</p>
      ) : (
        <>
          <label htmlFor="note" className="label mt-4">Reviewer note {level === 'low' ? '(optional for approval)' : '(required)'}</label>
          <textarea id="note" className="input min-h-24" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you verify, and why this decision?" />
          <div className="mt-3 grid gap-2">
            {ORDER.filter((a) => allowed_actions.includes(a)).map((a) => (
              <button key={a} className={BTN[a]} disabled={busy !== null} onClick={() => void submit(a)}>
                {busy === a ? 'Saving…' : ACTION_LABEL[a]}
              </button>
            ))}
          </div>
          {d.permissions.allowed_actions.length < ORDER.length && (
            <p className="mt-3 text-xs text-slate-600">“Reject – suspected fraud” is reserved for the Chief Auditor.</p>
          )}
        </>
      )}
    </section>
  );
}
