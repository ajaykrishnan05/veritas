import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorBanner, PageHeader, RiskBadge } from '../components/ui.tsx';
import { useSessionGuard } from '../features/auth/AuthContext.tsx';
import Dropzone, { checkFile } from '../features/invoice-upload/Dropzone.tsx';
import ProgressSteps from '../features/invoice-upload/ProgressSteps.tsx';
import { api, ApiClientError, errorMessage } from '../lib/api.ts';
import type { InvoiceDetail, ProcessingStage, RiskLevel } from '../types/index.ts';

interface DemoDoc { key: string; title: string; scenario: string; filename: string; expected: { level: RiskLevel; action: string } }

export default function UploadPage() {
  const navigate = useNavigate();
  const guard = useSessionGuard();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ProcessingStage | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; existingId?: string } | null>(null);
  const [demos, setDemos] = useState<DemoDoc[]>([]);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { api.get<DemoDoc[]>('/invoices/demo-documents').then(setDemos).catch(() => undefined); }, []);

  const track = useCallback(async (id: string) => {
    // Poll the server-reported pipeline stage until it finishes.
    for (let i = 0; i < 200 && alive.current; i++) {
      const d = await api.get<InvoiceDetail>(`/invoices/${id}`);
      setStage(d.invoice.processing_stage);
      if (d.invoice.processing_stage === 'done') return navigate(`/invoices/${id}`);
      if (d.invoice.processing_stage === 'failed') {
        setError({ message: d.invoice.processing_error ?? 'Extraction failed.', existingId: id });
        return;
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    if (alive.current) setError({ message: 'Processing is taking longer than expected. Check the dashboard shortly.' });
  }, [navigate]);

  const run = useCallback(async (label: string, send: () => Promise<{ id: string }>) => {
    setError(null);
    setBusy(true);
    setStage(null);
    setFileName(label);
    try {
      const { id } = await send();
      await track(id);
    } catch (e) {
      guard(e);
      const existingId = e instanceof ApiClientError && e.code === 'duplicate_upload' ? String(e.extra.invoice_id ?? '') : undefined;
      setError({ message: errorMessage(e), existingId: existingId || undefined });
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [guard, track]);

  const onFile = (file: File) => {
    const problem = checkFile(file);
    if (problem) { setFileName(null); setError({ message: problem }); return; }
    const form = new FormData();
    form.append('file', file);
    void run(file.name, () => api.post<{ id: string }>('/invoices', form));
  };

  return (
    <>
      <PageHeader title="Upload invoice" subtitle="PayGuard extracts the fields, compares them with trusted history and explains the result before anyone approves payment." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {error && (
            <ErrorBanner title="Could not process this invoice">
              {error.message}
              {error.existingId && <> <Link className="font-semibold underline" to={`/invoices/${error.existingId}`}>Open the existing record</Link>.</>}
            </ErrorBanner>
          )}
          <Dropzone onFile={onFile} disabled={busy} />
          {busy && (
            <div className="card p-5">
              <p className="mb-3 text-sm font-semibold">Processing {fileName}</p>
              <ProgressSteps stage={stage} />
            </div>
          )}
        </div>

        <aside className="card p-4" aria-labelledby="demo-title">
          <h2 id="demo-title" className="text-base font-semibold">Demo documents</h2>
          <p className="mt-1 text-xs text-slate-600">Synthetic invoices that run through the same pipeline. Real uploads need an AI provider configured on the server.</p>
          <ul className="mt-3 space-y-3">
            {demos.map((d) => (
              <li key={d.key} className="rounded-md border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{d.title}</p>
                  <RiskBadge level={d.expected.level} />
                </div>
                <p className="mt-1 text-xs text-slate-600">{d.scenario}</p>
                <button className="btn-secondary mt-2 w-full" aria-label={`Process this demo: ${d.title}`} disabled={busy} onClick={() => void run(d.filename, () => api.post<{ id: string }>(`/invoices/demo/${d.key}`))}>
                  Process this demo
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
