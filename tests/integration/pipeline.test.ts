import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../../server/services/ai/provider.ts';
import { DEMO_INVOICES } from '../../server/services/invoice-extraction/demo-fixtures.ts';
import { buildPdf } from '../../scripts/seed/pdf.ts';
import { login, makeCtx, processDemo } from './helpers.ts';
import type { InvoiceDetail } from '../../src/types/index.ts';

const detail = async (c: Awaited<ReturnType<typeof login>>, id: string) => (await c.get(`/api/invoices/${id}`)).body as InvoiceDetail;
const rules = (d: InvoiceDetail) => d.assessment!.triggered_rules.filter((r) => r.points > 0).map((r) => r.rule_name).sort();

describe('invoice processing pipeline (deterministic fallback)', () => {
  const ctx = makeCtx();

  it('scenario 1: normal invoice is low risk with no findings', async () => {
    const c = await login(ctx, 'operator');
    const d = await detail(c, await processDemo(c, 'normal'));
    expect(d.invoice.extraction_status).toBe('complete');
    expect(d.invoice.status).toBe('pending_review');
    expect(d.vendor?.legal_name).toBe('Apex Office Supplies LLC');
    expect(d.assessment).toMatchObject({ risk_score: 0, risk_level: 'low' });
    expect(d.permissions.allowed_actions).toContain('approve');
  });

  it('scenario 2: resubmitted invoice is a high-risk potential duplicate of a paid invoice', async () => {
    const c = await login(ctx, 'operator');
    const d = await detail(c, await processDemo(c, 'duplicate'));
    expect(rules(d)).toEqual(['duplicate', 'previously_paid_match']);
    expect(d.assessment).toMatchObject({ risk_score: 80, risk_level: 'high' });
    expect(d.assessment!.comparison_evidence.related_invoices[0]).toMatchObject({ invoice_number: 'INV-BRL-3302', paid: true });
    expect(d.assessment!.explanation.recommended_action).toBe('hold');
    expect(d.permissions.allowed_actions).toEqual([]);
  });

  it('scenario 3: bank suffix mismatch is high risk and shows verified vs invoice suffix', async () => {
    const c = await login(ctx, 'operator');
    const d = await detail(c, await processDemo(c, 'bank-mismatch'));
    expect(rules(d)).toEqual(['bank_mismatch', 'po_mismatch', 'price_anomaly']);
    expect(d.assessment).toMatchObject({ risk_score: 60, risk_level: 'high' });
    expect(d.invoice.bank_account_last4).toBe('5512');
    expect(d.vendor?.verified_bank_last4).toBe('7305');
  });

  it('scenario 4: tax and price anomaly is medium risk', async () => {
    const c = await login(ctx, 'operator');
    const d = await detail(c, await processDemo(c, 'tax-price-anomaly'));
    expect(rules(d)).toEqual(['po_mismatch', 'price_anomaly', 'tax_anomaly']);
    expect(d.assessment).toMatchObject({ risk_score: 45, risk_level: 'medium' });
    expect(d.assessment!.explanation.recommended_action).toBe('review');
  });

  it('scenario 5: a legitimate unusual invoice is flagged for review, not rejected', async () => {
    const c = await login(ctx, 'operator');
    const d = await detail(c, await processDemo(c, 'legit-unusual'));
    expect(rules(d)).toEqual(['price_anomaly', 'tax_anomaly']);
    expect(d.assessment).toMatchObject({ risk_score: 30, risk_level: 'medium' });
    expect(JSON.stringify(d.assessment!.explanation)).not.toMatch(/fraud/i);
    expect(d.permissions.allowed_actions).toContain('approve');
  });

  it('matches the expected level for every documented demo scenario', async () => {
    const c = await login(ctx, 'auditor');
    for (const demo of DEMO_INVOICES) {
      const res = await c.get('/api/invoices');
      const inv = (res.body as Array<{ original_filename: string; risk_level: string }>).find((i) => i.original_filename === demo.filename);
      expect(inv?.risk_level, demo.key).toBe(demo.expected.level);
    }
  });

  it('logs both AI operations with prompt versions and never stores secrets or full account numbers', () => {
    const rows = ctx.db.prepare('SELECT * FROM ai_logs').all() as Array<{ operation: string; prompt_version: string; request_id: string; validation_status: string; invoice_id: string; input_metadata: string; model_name: string }>;
    expect(rows.length).toBe(10);
    expect(new Set(rows.map((r) => `${r.operation}:${r.prompt_version}`))).toEqual(new Set(['extraction:invoice_extraction_v1', 'explanation:risk_explanation_v1']));
    expect(rows.every((r) => r.request_id && r.invoice_id && r.validation_status === 'fallback' && r.model_name.startsWith('deterministic'))).toBe(true);
    expect(rows.map((r) => r.input_metadata).join()).not.toMatch(/\d{9,}|api[_-]?key/i);
  });

  it('rejects re-uploading an identical document', async () => {
    const c = await login(ctx, 'operator');
    const res = await c.post('/api/invoices/demo/normal?wait=1');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('duplicate_upload');
    expect(res.body.error.invoice_id).toBeTruthy();
  });
});

describe('upload validation and extraction failures', () => {
  const ctx = makeCtx({ env: { MAX_UPLOAD_MB: '0.01' } });
  const pdf = (marker: string) => buildPdf([{ text: 'Some other invoice' }], marker);

  it('rejects unsupported types, mismatched MIME, empty, corrupt and oversize files', async () => {
    const c = await login(ctx, 'operator');
    const up = (buf: Buffer, name: string, type: string) => c.post('/api/invoices?wait=1').attach('file', buf, { filename: name, contentType: type });
    expect((await up(Buffer.from('hello'), 'notes.txt', 'text/plain')).status).toBe(415);
    expect((await up(pdf('x'), 'a.pdf', 'image/png')).status).toBe(415);
    expect((await up(Buffer.alloc(0), 'a.pdf', 'application/pdf')).status).toBe(400);
    const corrupt = await up(Buffer.from('this is not a pdf'), 'a.pdf', 'application/pdf');
    expect(corrupt.status).toBe(400);
    expect(corrupt.body.error.code).toBe('corrupt_file');
    expect((await up(Buffer.from('not a png at all'), 'a.png', 'image/png')).status).toBe(400);
    const big = await up(Buffer.concat([pdf('x'), Buffer.alloc(20_000)]), 'big.pdf', 'application/pdf');
    expect(big.status).toBe(413);
    const noFile = await c.post('/api/invoices?wait=1');
    expect(noFile.status).toBe(400);
  });

  it('a valid but unreadable document ends as needs_manual_entry (fields are never guessed)', async () => {
    const c = await login(ctx, 'operator');
    const res = await c.post('/api/invoices?wait=1').attach('file', pdf('nothing'), { filename: 'scan.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(202);
    const d = (await c.get(`/api/invoices/${res.body.id}`)).body as InvoiceDetail;
    expect(d.invoice.status).toBe('extraction_failed');
    expect(d.invoice.extraction_status).toBe('needs_manual_entry');
    expect(d.invoice.processing_error).toMatch(/cannot be extracted automatically/);
    expect(d.invoice.extracted_vendor_name).toBeNull();
    expect(d.assessment).toBeNull();
  });

  it('stores files under generated names and serves them back to signed-in users only', async () => {
    const c = await login(ctx, 'operator');
    const buf = pdf('stored');
    const res = await c.post('/api/invoices?wait=1').attach('file', buf, { filename: '../../evil name.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(202);
    const row = ctx.db.prepare('SELECT file_path, original_filename FROM invoices WHERE id = ?').get(res.body.id) as { file_path: string; original_filename: string };
    expect(row.file_path).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    const doc = await c.get(`/api/invoices/${res.body.id}/document`);
    expect(doc.status).toBe(200);
    expect(doc.headers['content-type']).toBe('application/pdf');
    expect(doc.headers['x-content-type-options']).toBe('nosniff');
    const { default: request } = await import('supertest');
    expect((await request(ctx.app).get(`/api/invoices/${res.body.id}/document`)).status).toBe(401);
  });
});

describe('AI provider path', () => {
  const goodExtraction = {
    vendor_name: 'Apex Office Supplies LLC', invoice_number: 'INV-AI-1', invoice_date: '2026-06-22', subtotal: 100, tax_rate: 8, tax_amount: 8, total_amount: 108,
    bank_account_last4: '4821', purchase_order_number: null, line_items: [{ description: 'Copy paper case (10 reams)', quantity: 2, unit_price: 50, amount: 100 }],
    confidence: { vendor_name: 0.9, invoice_number: 0.9, invoice_date: 0.9, total_amount: 0.9, tax_rate: 0.8 },
  };
  const fakeFetch = (responses: string[]) => {
    let i = 0;
    return (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: responses[i++] }] }), { status: 200 })) as unknown as typeof fetch;
  };
  const sendPdf = (c: Awaited<ReturnType<typeof login>>) => c.post('/api/invoices?wait=1').attach('file', buildPdf([{ text: 'x' }], 'ai-doc'), { filename: 'ai.pdf', contentType: 'application/pdf' });

  it('uses validated AI output for extraction and explanation, and logs both', async () => {
    const explanation = { summary: 'Everything matches vendor history.', reasons: ['No discrepancies were found.'], recommended_action: 'approve', missing_verification: [] };
    const ctx = makeCtx({ provider: new AnthropicProvider('test-key', 'test-model', 'http://ai.invalid', fakeFetch([JSON.stringify(goodExtraction), JSON.stringify(explanation)])) });
    const c = await login(ctx, 'operator');
    const res = await sendPdf(c);
    const d = (await c.get(`/api/invoices/${res.body.id}`)).body as InvoiceDetail;
    expect(d.invoice.invoice_number).toBe('INV-AI-1');
    expect(d.assessment!.explanation.summary).toBe('Everything matches vendor history.');
    const logs = ctx.db.prepare('SELECT operation, validation_status, model_name FROM ai_logs ORDER BY created_at').all();
    expect(logs).toEqual([
      { operation: 'extraction', validation_status: 'passed', model_name: 'test-model' },
      { operation: 'explanation', validation_status: 'passed', model_name: 'test-model' },
    ]);
  });

  it('fails extraction safely on schema-invalid output (extra keys, markdown, bad confidence)', async () => {
    for (const bad of [JSON.stringify({ ...goodExtraction, extra: 1 }), '```json\n{}\n```', JSON.stringify({ ...goodExtraction, confidence: { ...goodExtraction.confidence, tax_rate: 4 } })]) {
      const ctx = makeCtx({ provider: new AnthropicProvider('test-key', 'test-model', 'http://ai.invalid', fakeFetch([bad])) });
      const c = await login(ctx, 'operator');
      const res = await sendPdf(c);
      const d = (await c.get(`/api/invoices/${res.body.id}`)).body as InvoiceDetail;
      expect(d.invoice.status).toBe('extraction_failed');
      expect(d.invoice.processing_error).toMatch(/Extraction failed/);
      const log = ctx.db.prepare('SELECT validation_status, error_message FROM ai_logs').get() as { validation_status: string; error_message: string };
      expect(log.validation_status).toBe('failed');
      expect(log.error_message).toBeTruthy();
    }
  });

  it('falls back to the deterministic explanation when AI output is invalid or asserts fraud, without changing the score', async () => {
    const fraud = { summary: 'This invoice is fraudulent.', reasons: ['Looks bad.'], recommended_action: 'hold', missing_verification: [] };
    const weak = { summary: 'Fine.', reasons: ['Ok.'], recommended_action: 'approve', missing_verification: [] };
    // Bank mismatch + (no other signals) = medium; "approve" would be weaker than required.
    const mismatch = { ...goodExtraction, bank_account_last4: '9999' };
    for (const out of [fraud, weak, 'not json']) {
      const ctx = makeCtx({ provider: new AnthropicProvider('test-key', 'test-model', 'http://ai.invalid', fakeFetch([JSON.stringify(mismatch), typeof out === 'string' ? out : JSON.stringify(out)])) });
      const c = await login(ctx, 'operator');
      const res = await sendPdf(c);
      const d = (await c.get(`/api/invoices/${res.body.id}`)).body as InvoiceDetail;
      expect(d.assessment!.risk_score).toBe(30);
      expect(d.assessment!.explanation.recommended_action).toBe('review');
      expect(d.assessment!.explanation.summary).not.toMatch(/fraudulent/);
      const exp = ctx.db.prepare("SELECT validation_status FROM ai_logs WHERE operation = 'explanation'").get() as { validation_status: string };
      expect(exp.validation_status).toBe('failed');
    }
  });

  it('never leaks the API key in errors when the provider call fails', async () => {
    const failing = (async () => new Response('secret details', { status: 500 })) as unknown as typeof fetch;
    const ctx = makeCtx({ provider: new AnthropicProvider('sk-super-secret', 'test-model', 'http://ai.invalid', failing) });
    const c = await login(ctx, 'operator');
    const res = await sendPdf(c);
    const d = (await c.get(`/api/invoices/${res.body.id}`)).body as InvoiceDetail;
    expect(d.invoice.status).toBe('extraction_failed');
    expect(JSON.stringify(d) + JSON.stringify(ctx.db.prepare('SELECT * FROM ai_logs').all())).not.toContain('sk-super-secret');
  });
});
