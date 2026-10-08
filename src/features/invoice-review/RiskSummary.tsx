import { RiskBadge } from '../../components/ui.tsx';
import type { InvoiceDetail } from '../../types/index.ts';

const HEADLINE = {
  low: 'Low risk: no significant discrepancies found against vendor and payment history.',
  medium: 'Medium risk: review the flagged items before approving.',
  high: 'High risk: payment should be held for verification.',
} as const;
const BORDER = { low: 'border-l-green-600', medium: 'border-l-amber-500', high: 'border-l-red-600' } as const;
const ACTION = { approve: 'Approve', review: 'Review before approving', hold: 'Hold for verification' } as const;

export default function RiskSummary({ a }: { a: NonNullable<InvoiceDetail['assessment']> }) {
  const ex = a.explanation;
  return (
    <section className={`card border-l-4 p-5 ${BORDER[a.risk_level]}`} aria-labelledby="risk-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="risk-heading" className="text-lg font-bold">Risk assessment</h2>
        <RiskBadge level={a.risk_level} score={a.risk_score} large />
        <span className="text-sm text-slate-600">Score {a.risk_score} / 100, calculated by fixed rules (not by AI)</span>
      </div>
      <p className="mt-3 font-semibold">{HEADLINE[a.risk_level]}</p>

      <div className="mt-4 rounded-md bg-slate-50 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Explanation</h3>
        <p className="mt-1">{ex.summary}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {ex.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
        <p className="mt-3 text-sm"><span className="font-semibold">Suggested next step:</span> {ACTION[ex.recommended_action]}</p>
        {ex.missing_verification.length > 0 && (
          <div className="mt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Still to verify</h4>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{ex.missing_verification.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">This is decision support. Findings indicate potential issues to verify; they are not a determination of wrongdoing.</p>
    </section>
  );
}
