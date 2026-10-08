import { RULE_LABEL } from '../../lib/format.ts';
import type { Finding, Severity } from '../../types/index.ts';

const SEV: Record<Severity, string> = {
  info: 'bg-slate-100 text-slate-800',
  low: 'bg-slate-100 text-slate-800',
  medium: 'bg-amber-100 text-amber-900',
  high: 'bg-red-100 text-red-900',
};

export default function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <p className="rounded-md bg-green-50 p-4 text-sm text-green-900">No rules were triggered. Vendor, bank details, tax rate, prices, purchase order and history are consistent.</p>;
  }
  return (
    <ul className="space-y-3">
      {findings.map((f, i) => (
        <li key={`${f.rule_name}-${i}`} className="rounded-md border border-slate-200 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{RULE_LABEL[f.rule_name] ?? f.rule_name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEV[f.severity]}`}>{f.severity}</span>
            <span className="ml-auto font-mono text-sm font-semibold">{f.points > 0 ? `+${f.points}` : 'info'}</span>
          </div>
          <p className="mt-1 text-sm">{f.evidence}</p>
          <details className="mt-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium">Values used for comparison</summary>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono">{JSON.stringify(f.values_used_for_comparison, null, 2)}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}
