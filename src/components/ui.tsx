import type { ReactNode } from 'react';
import { RISK_LABEL, STATUS_LABEL } from '../lib/format.ts';
import type { InvoiceStatus, RiskLevel } from '../types/index.ts';

const RISK_STYLE: Record<RiskLevel, string> = {
  low: 'bg-green-100 text-green-900 ring-green-600/30',
  medium: 'bg-amber-100 text-amber-900 ring-amber-600/40',
  high: 'bg-red-100 text-red-900 ring-red-600/30',
};
const RISK_ICON: Record<RiskLevel, string> = { low: '✓', medium: '!', high: '▲' };

export function RiskBadge({ level, score, large }: { level: RiskLevel | null; score?: number | null; large?: boolean }) {
  if (!level) return <span className="text-sm text-slate-500">Not assessed</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold ring-1 ring-inset ${RISK_STYLE[level]} ${large ? 'text-base px-3 py-1' : 'text-xs'}`}>
      <span aria-hidden="true">{RISK_ICON[level]}</span>
      {RISK_LABEL[level]}
      {score != null && <span className="font-mono">· {score}</span>}
    </span>
  );
}

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  processing: 'bg-slate-100 text-slate-800',
  pending_review: 'bg-indigo-100 text-indigo-900',
  approved: 'bg-green-100 text-green-900',
  held: 'bg-amber-100 text-amber-900',
  rejected: 'bg-red-100 text-red-900',
  extraction_failed: 'bg-red-100 text-red-900',
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary" aria-hidden="true" />
      {label ?? 'Loading…'}
    </span>
  );
}

export function ErrorBanner({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return <div role="status" className="rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
