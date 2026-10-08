export default function DocumentPreview({ id, mime, filename }: { id: string; mime: string; filename: string }) {
  const src = `/api/invoices/${id}/document`;
  return (
    <section className="card p-4" aria-labelledby="doc-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="doc-heading" className="text-base font-semibold">Document</h2>
        <a className="text-sm font-semibold text-primary hover:underline" href={src} target="_blank" rel="noreferrer">Open in new tab</a>
      </div>
      {mime === 'application/pdf' ? (
        <iframe title={`Invoice document ${filename}`} src={src} className="h-96 w-full rounded border border-slate-200 bg-slate-50" />
      ) : (
        <img alt={`Uploaded invoice ${filename}`} src={src} className="max-h-96 w-full rounded border border-slate-200 object-contain" />
      )}
      <p className="mt-1 truncate text-xs text-slate-500" title={filename}>{filename}</p>
    </section>
  );
}
