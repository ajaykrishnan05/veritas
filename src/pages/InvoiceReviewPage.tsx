import * as Tabs from '@radix-ui/react-tabs';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorBanner, PageHeader, RiskBadge, Spinner, StatusBadge } from '../components/ui.tsx';
import { useSessionGuard } from '../features/auth/AuthContext.tsx';
import DecisionPanel from '../features/invoice-review/DecisionPanel.tsx';
import DocumentPreview from '../features/invoice-review/DocumentPreview.tsx';
import ExtractionPanel from '../features/invoice-review/ExtractionPanel.tsx';
import FindingsList from '../features/invoice-review/FindingsList.tsx';
import ReviewHistory from '../features/invoice-review/ReviewHistory.tsx';
import RiskSummary from '../features/invoice-review/RiskSummary.tsx';
import VendorVerification from '../features/invoice-review/VendorVerification.tsx';
import ProgressSteps from '../features/invoice-upload/ProgressSteps.tsx';
import { api, ApiClientError, errorMessage } from '../lib/api.ts';
import { dateOnly, money } from '../lib/format.ts';
import type { InvoiceDetail } from '../types/index.ts';

const tab = 'border-b-2 border-transparent px-4 py-2 text-sm font-semibold text-slate-600 hover:text-ink data-[state=active]:border-primary data-[state=active]:text-primary';

export default function InvoiceReviewPage() {
  const { id = '' } = useParams();
  const guard = useSessionGuard();
  const [d, setD] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      setD(await api.get<InvoiceDetail>(`/invoices/${id}`));
      setError(null);
    } catch (e) {
      guard(e);
      setError({ message: errorMessage(e), notFound: e instanceof ApiClientError && e.status === 404 });
    }
  }, [id, guard]);

  useEffect(() => { setD(null); void load(); }, [load]);

  const inFlight = d && d.invoice.processing_stage !== 'done' && d.invoice.processing_stage !== 'failed';
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void load(), 500);
    return () => clearInterval(t);
  }, [inFlight, load]);

  if (error && !d) {
    return (
      <>
        <ErrorBanner title={error.notFound ? 'Invoice not found' : 'Could not load this invoice'}>{error.message}</ErrorBanner>
        <p className="mt-4"><Link to="/" className="btn-secondary">Back to dashboard</Link></p>
      </>
    );
  }
  if (!d) return <Spinner label="Loading invoice…" />;

  const inv = d.invoice;
  if (inFlight) {
    return (
      <div className="card mx-auto max-w-lg p-6">
        <h1 className="mb-4 text-lg font-bold">Processing {inv.original_filename}</h1>
        <ProgressSteps stage={inv.processing_stage} />
      </div>
    );
  }
  if (inv.processing_stage === 'failed' || !d.assessment) {
    return (
      <>
        <PageHeader title={inv.original_filename} subtitle="This document could not be processed." />
        <ErrorBanner title="Extraction failed">
          {inv.processing_error ?? 'No fields could be extracted.'}
          {inv.extraction_status === 'needs_manual_entry' && ' Configure an AI provider on the server (see the README), or use one of the demo documents.'}
        </ErrorBanner>
        <p className="mt-4 flex gap-2"><Link to="/upload" className="btn-primary">Upload another invoice</Link><Link to="/" className="btn-secondary">Dashboard</Link></p>
      </>
    );
  }

  const a = d.assessment;
  return (
    <>
      <p className="mb-2 text-sm"><Link to="/" className="text-primary hover:underline">← Dashboard</Link></p>
      <PageHeader
        title={`${inv.invoice_number ?? 'Invoice'} · ${d.vendor?.display_name ?? inv.extracted_vendor_name ?? 'Unknown vendor'}`}
        subtitle={`${money(inv.total_amount)} · dated ${dateOnly(inv.invoice_date)} · uploaded by ${inv.uploaded_by_name ?? 'unknown'}`}
        actions={<div className="flex items-center gap-2"><RiskBadge level={a.risk_level} score={a.risk_score} /><StatusBadge status={inv.status} /></div>}
      />
      {error && <div className="mb-4"><ErrorBanner>{error.message}</ErrorBanner></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <RiskSummary a={a} />
          <Tabs.Root defaultValue="findings" className="card">
            <Tabs.List aria-label="Invoice details" className="flex flex-wrap border-b border-slate-200">
              <Tabs.Trigger value="findings" className={tab}>Findings ({a.triggered_rules.filter((f) => f.points > 0).length})</Tabs.Trigger>
              <Tabs.Trigger value="vendor" className={tab}>Vendor &amp; history</Tabs.Trigger>
              <Tabs.Trigger value="extraction" className={tab}>Extracted fields</Tabs.Trigger>
              <Tabs.Trigger value="history" className={tab}>Review history ({d.decisions.length})</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="findings" className="p-5"><FindingsList findings={a.triggered_rules} /></Tabs.Content>
            <Tabs.Content value="vendor" className="p-5"><VendorVerification d={d} /></Tabs.Content>
            <Tabs.Content value="extraction" className="p-5"><ExtractionPanel inv={inv} /></Tabs.Content>
            <Tabs.Content value="history" className="p-5"><ReviewHistory decisions={d.decisions} /></Tabs.Content>
          </Tabs.Root>
        </div>
        <div className="space-y-6">
          <DecisionPanel d={d} onDone={() => void load()} />
          <DocumentPreview id={inv.id} mime={inv.mime_type} filename={inv.original_filename} />
        </div>
      </div>
    </>
  );
}
