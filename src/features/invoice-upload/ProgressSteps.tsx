import type { ProcessingStage } from '../../types/index.ts';

const STEPS: Array<{ key: string; label: string; stages: ProcessingStage[] }> = [
  { key: 'upload', label: 'Uploading', stages: [] },
  { key: 'extract', label: 'Extracting fields', stages: ['uploaded', 'extracting'] },
  { key: 'compare', label: 'Comparing with vendor and payment history', stages: ['comparing'] },
  { key: 'explain', label: 'Generating explanation', stages: ['explaining'] },
];

/** stage: null while the file is still being sent. */
export default function ProgressSteps({ stage, failed }: { stage: ProcessingStage | null; failed?: boolean }) {
  const active = stage === null ? 0 : stage === 'done' ? STEPS.length : Math.max(1, STEPS.findIndex((s) => s.stages.includes(stage)));
  return (
    <ol className="space-y-2" aria-label="Processing progress">
      {STEPS.map((s, i) => {
        const state = i < active ? 'done' : i === active ? (failed ? 'failed' : 'active') : 'todo';
        return (
          <li key={s.key} className="flex items-center gap-3 text-sm" aria-current={state === 'active' ? 'step' : undefined}>
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${state === 'done' ? 'bg-green-700 text-white' : state === 'active' ? 'bg-primary text-white' : state === 'failed' ? 'bg-red-700 text-white' : 'bg-slate-200 text-slate-600'}`}
            >
              {state === 'done' ? '✓' : state === 'failed' ? '!' : i + 1}
            </span>
            <span className={state === 'todo' ? 'text-slate-500' : 'font-medium'}>
              {s.label}
              {state === 'active' && '…'}
              <span className="sr-only"> ({state === 'done' ? 'complete' : state === 'active' ? 'in progress' : state === 'failed' ? 'failed' : 'waiting'})</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
