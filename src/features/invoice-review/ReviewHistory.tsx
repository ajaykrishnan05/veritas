import { ACTION_LABEL, dateTime } from '../../lib/format.ts';
import type { DecisionView } from '../../types/index.ts';

export default function ReviewHistory({ decisions }: { decisions: DecisionView[] }) {
  if (decisions.length === 0) return <p className="text-sm text-slate-600">No review decisions yet.</p>;
  return (
    <ol className="space-y-3">
      {decisions.map((d) => (
        <li key={d.id} className="rounded-md border border-slate-200 p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-semibold">{ACTION_LABEL[d.action]}</span>
            <time dateTime={d.created_at} className="text-slate-600">{dateTime(d.created_at)}</time>
          </div>
          <p className="text-slate-600">by {d.reviewer_name}</p>
          {d.reviewer_note && <p className="mt-1 whitespace-pre-wrap">{d.reviewer_note}</p>}
        </li>
      ))}
      <li className="text-xs text-slate-500">Decisions are append-only: earlier entries are never edited or removed.</li>
    </ol>
  );
}
