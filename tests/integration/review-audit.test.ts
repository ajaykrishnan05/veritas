import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { csvCell, CSV_COLUMNS } from '../../server/audit/router.ts';
import { login, makeCtx, processDemo, type Client } from './helpers.ts';

const ctx = makeCtx();
let op: Client;
let auditor: Client;
const ids: Record<string, string> = {};

beforeAll(async () => {
  op = await login(ctx, 'operator');
  auditor = await login(ctx, 'auditor');
  for (const key of ['normal', 'duplicate', 'bank-mismatch', 'tax-price-anomaly', 'legit-unusual']) ids[key] = await processDemo(op, key);
});

const decide = (c: Client, id: string, action: string, note?: string) => c.post(`/api/invoices/${id}/decisions`).send({ action, note });

describe('authentication', () => {
  it('requires a session for API routes and rejects bad credentials', async () => {
    expect((await request(ctx.app).get('/api/invoices')).status).toBe(401);
    expect((await request(ctx.app).get('/api/audit')).status).toBe(401);
    const bad = await request(ctx.app).post('/api/auth/login').set('X-PayGuard-CSRF', '1').send({ email: 'operator@payguard.demo', password: 'wrong-password' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('invalid_credentials');
  });

  it('rejects mutating requests without the CSRF header', async () => {
    const res = await request(ctx.app).post('/api/auth/login').send({ email: 'operator@payguard.demo', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('sets an httpOnly session cookie, never exposes password hashes, and logout invalidates the session', async () => {
    const agent = request.agent(ctx.app);
    const res = await agent.post('/api/auth/login').set('X-PayGuard-CSRF', '1').send({ email: 'auditor@payguard.demo', password: 'test-password-123' });
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|password/i);
    expect((await agent.get('/api/auth/me')).body.role).toBe('chief_auditor');
    await agent.post('/api/auth/logout').set('X-PayGuard-CSRF', '1');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('review decision authorization (server-side)', () => {
  it('blocks a Finance Operator from resolving a high-risk invoice, whatever the action', async () => {
    for (const action of ['approve', 'hold', 'reject_duplicate', 'reject_fraud']) {
      const res = await decide(op, ids.duplicate, action, 'trying anyway');
      expect(res.status, action).toBe(403);
      expect(res.body.error.message).toMatch(/Chief Auditor/);
    }
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM review_decisions WHERE invoice_id = ?').get(ids.duplicate)).toEqual({ n: 0 });
    const d = (await op.get(`/api/invoices/${ids.duplicate}`)).body;
    expect(d.invoice.status).toBe('pending_review');
    expect(d.permissions.allowed_actions).toEqual([]);
  });

  it('lets a Finance Operator approve a low-risk invoice (note optional) and records reviewer + timestamp', async () => {
    const res = await decide(op, ids.normal, 'approve');
    expect(res.status).toBe(201);
    const d = (await op.get(`/api/invoices/${ids.normal}`)).body;
    expect(d.invoice.status).toBe('approved');
    expect(d.decisions).toHaveLength(1);
    expect(d.decisions[0]).toMatchObject({ action: 'approve', reviewer_id: 'user-operator', reviewer_name: 'Olivia Operator' });
    expect(Date.parse(d.decisions[0].created_at)).not.toBeNaN();
  });

  it('does not create any payment when an invoice is approved', () => {
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM payments WHERE invoice_id = ?').get(ids.normal)).toEqual({ n: 0 });
  });

  it('treats decisions on a resolved invoice as final (409)', async () => {
    const res = await decide(auditor, ids.normal, 'hold', 'too late');
    expect(res.status).toBe(409);
  });

  it('requires a note for hold/reject and for approving medium risk', async () => {
    expect((await decide(op, ids['tax-price-anomaly'], 'hold')).status).toBe(400);
    expect((await decide(op, ids['tax-price-anomaly'], 'hold', '   ')).status).toBe(400);
    expect((await decide(op, ids['legit-unusual'], 'approve')).status).toBe(400);
    expect((await decide(auditor, ids.duplicate, 'reject_duplicate')).status).toBe(400);
  });

  it('lets a Finance Operator review medium risk, but not reject for fraud', async () => {
    expect((await decide(op, ids['legit-unusual'], 'reject_fraud', 'no')).status).toBe(403);
    const ok = await decide(op, ids['legit-unusual'], 'approve', 'Price list update confirmed with vendor; PO covers total.');
    expect(ok.status).toBe(201);
  });

  it('validates the payload', async () => {
    expect((await decide(auditor, ids['bank-mismatch'], 'delete_everything', 'x')).status).toBe(400);
    expect((await decide(auditor, ids['bank-mismatch'], 'hold', 'x'.repeat(1001))).status).toBe(400);
    expect((await decide(auditor, 'does-not-exist', 'hold', 'x')).status).toBe(404);
  });

  it('lets the Chief Auditor hold and then reject a high-risk invoice, keeping both decisions', async () => {
    expect((await decide(auditor, ids['bank-mismatch'], 'hold', 'Calling vendor on the number on file.')).status).toBe(201);
    expect((await auditor.get(`/api/invoices/${ids['bank-mismatch']}`)).body.invoice.status).toBe('held');
    // Operators still cannot touch a held high-risk invoice.
    expect((await decide(op, ids['bank-mismatch'], 'approve', 'x')).status).toBe(403);
    expect((await decide(auditor, ids['bank-mismatch'], 'reject_fraud', 'Vendor denies changing bank details.')).status).toBe(201);
    const d = (await auditor.get(`/api/invoices/${ids['bank-mismatch']}`)).body;
    expect(d.invoice.status).toBe('rejected');
    expect(d.decisions.map((x: { action: string }) => x.action)).toEqual(['hold', 'reject_fraud']);
  });

  it('lets the Chief Auditor reject a duplicate with a note', async () => {
    const res = await decide(auditor, ids.duplicate, 'reject_duplicate', 'Duplicate of INV-BRL-3302, already paid 2026-06-28.');
    expect(res.status).toBe(201);
    expect((await auditor.get(`/api/invoices/${ids.duplicate}`)).body.invoice.status).toBe('rejected');
  });
});

describe('append-only audit trail', () => {
  it('prevents UPDATE and DELETE on decisions, AI logs and risk assessments at the database level', () => {
    expect(() => ctx.db.prepare("UPDATE review_decisions SET reviewer_note = 'tampered'").run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare('DELETE FROM review_decisions').run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare("UPDATE ai_logs SET validation_status = 'passed'").run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare('DELETE FROM ai_logs').run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare('UPDATE risk_assessments SET risk_score = 0').run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare('DELETE FROM risk_assessments').run()).toThrow(/append-only/);
  });

  it('exposes no API route that edits or deletes a decision', async () => {
    const row = ctx.db.prepare('SELECT id FROM review_decisions LIMIT 1').get() as { id: string };
    for (const m of ['put', 'patch', 'delete'] as const) {
      const res = await auditor.agent[m](`/api/invoices/${ids.normal}/decisions/${row.id}`).set('X-PayGuard-CSRF', '1');
      expect(res.status).toBe(404);
      const onCollection = await auditor.agent[m](`/api/invoices/${ids.normal}/decisions`).set('X-PayGuard-CSRF', '1');
      expect(onCollection.status).toBe(404);
    }
  });
});

describe('audit trail and CSV export', () => {
  it('shows the Chief Auditor every decision with the required fields', async () => {
    const rows = (await auditor.get('/api/audit')).body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.invoice_id === ids.duplicate)).toMatchObject({
      vendor: 'Brightline Logistics', invoice_number: 'BL-3302A', amount: 1802, risk_score: 80, risk_level: 'high',
      triggered_rules: ['duplicate', 'previously_paid_match'], decision: 'reject_duplicate', reviewer: 'Adrian Auditor',
    });
  });

  it('scopes Finance Operators to their own decisions', async () => {
    const rows = (await op.get('/api/audit')).body as Array<{ reviewer: string }>;
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.reviewer === 'Olivia Operator')).toBe(true);
  });

  it('supports search and filters', async () => {
    const byVendor = (await auditor.get('/api/audit?q=brightline')).body;
    expect(byVendor).toHaveLength(1);
    expect((await auditor.get('/api/audit?q=INV-CIT-5120')).body).toHaveLength(2);
    expect((await auditor.get('/api/audit?risk=high')).body).toHaveLength(3);
    expect((await auditor.get('/api/audit?decision=hold')).body).toHaveLength(1);
    expect((await auditor.get('/api/audit?q=100%25')).body).toHaveLength(0); // LIKE wildcards are escaped
    expect((await auditor.get("/api/audit?q=' OR 1=1 --")).body).toHaveLength(0);
    expect((await auditor.get('/api/audit?risk=bogus')).status).toBe(400);
  });

  it('exports CSV for the Chief Auditor with the specified columns', async () => {
    const res = await auditor.get('/api/audit/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="payguard-audit-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('invoice_id,vendor,invoice_number,amount,risk_score,risk_level,triggered_rules,decision,reviewer,reviewer_note,timestamp');
    expect(lines[0].split(',')).toEqual([...CSV_COLUMNS]);
    expect(lines).toHaveLength(6);
    const dup = lines.find((l) => l.includes('BL-3302A'))!;
    expect(dup).toContain('duplicate; previously_paid_match');
    expect(dup).toContain('reject_duplicate');
    expect(dup).toContain('"Duplicate of INV-BRL-3302, already paid 2026-06-28."');
  });

  it('respects filters in the export and forbids Finance Operators from exporting', async () => {
    const filtered = await auditor.get('/api/audit/export.csv?decision=hold');
    expect(filtered.text.trim().split('\r\n')).toHaveLength(2);
    const denied = await op.get('/api/audit/export.csv');
    expect(denied.status).toBe(403);
  });

  it('neutralizes spreadsheet formula injection and escapes CSV syntax', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
  });
});

describe('dashboard data', () => {
  it('summarizes totals and supports filtering', async () => {
    const s = (await auditor.get('/api/invoices/summary')).body;
    expect(s).toMatchObject({ total_invoices: 5, high_risk: 2, pending_reviews: 1 });
    expect(s.approved_amount).toBeCloseTo(1334.88 + 2784.6, 2);
    expect(s.held_amount).toBe(0);
    expect(s.amount_at_risk).toBeCloseTo(2020.2, 2); // only the unresolved medium-risk invoice
    const high = (await auditor.get('/api/invoices?risk=high')).body;
    expect(high).toHaveLength(2);
    expect((await auditor.get('/api/invoices?status=approved')).body).toHaveLength(2);
    const vendor = ctx.db.prepare("SELECT id FROM vendors WHERE vendor_code = 'V004'").get() as { id: string };
    expect((await auditor.get(`/api/invoices?vendor=${vendor.id}`)).body).toHaveLength(1);
    expect((await auditor.get('/api/invoices?status=nonsense')).status).toBe(400);
  });
});
