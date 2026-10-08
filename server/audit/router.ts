import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/client.ts';
import { ApiError } from '../http-error.ts';
import { requireRole } from '../middleware/authorization.ts';
import { parseJson } from '../invoices/repo.ts';
import type { AuditRow, Finding, SessionUser } from '../../src/types/index.ts';

const querySchema = z.object({
  q: z.string().max(100).optional(),
  risk: z.enum(['low', 'medium', 'high']).optional(),
  decision: z.enum(['approve', 'hold', 'reject_duplicate', 'reject_fraud']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function queryAudit(db: DB, user: SessionUser, rawQuery: unknown): AuditRow[] {
  const parsed = querySchema.safeParse(rawQuery);
  if (!parsed.success) throw new ApiError(400, 'invalid_filter', 'Invalid filter values.');
  const f = parsed.data;
  const clauses: string[] = ['1=1'];
  const params: unknown[] = [];
  // Finance operators only see their own decisions; Chief Auditors see everything.
  if (user.role !== 'chief_auditor') { clauses.push('d.reviewer_id = ?'); params.push(user.id); }
  if (f.risk) { clauses.push('ra.risk_level = ?'); params.push(f.risk); }
  if (f.decision) { clauses.push('d.action = ?'); params.push(f.decision); }
  if (f.from) { clauses.push('substr(d.created_at, 1, 10) >= ?'); params.push(f.from); }
  if (f.to) { clauses.push('substr(d.created_at, 1, 10) <= ?'); params.push(f.to); }
  if (f.q) {
    const like = `%${likeEscape(f.q.toLowerCase())}%`;
    clauses.push(`(lower(COALESCE(v.display_name, i.extracted_vendor_name, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(i.invoice_number, '')) LIKE ? ESCAPE '\\'
      OR lower(i.id) LIKE ? ESCAPE '\\' OR lower(p.full_name) LIKE ? ESCAPE '\\' OR lower(COALESCE(d.reviewer_note, '')) LIKE ? ESCAPE '\\')`);
    params.push(like, like, like, like, like);
  }
  const rows = db
    .prepare(
      `SELECT d.id AS decision_id, d.invoice_id, COALESCE(v.display_name, i.extracted_vendor_name, '') AS vendor, COALESCE(i.invoice_number, '') AS invoice_number,
         i.total_amount AS amount, ra.risk_score, ra.risk_level, ra.triggered_rules, d.action AS decision, p.full_name AS reviewer, d.reviewer_note, d.created_at AS timestamp
       FROM review_decisions d
       JOIN invoices i ON i.id = d.invoice_id
       JOIN profiles p ON p.id = d.reviewer_id
       LEFT JOIN vendors v ON v.id = i.vendor_id
       LEFT JOIN risk_assessments ra ON ra.invoice_id = i.id
       WHERE ${clauses.join(' AND ')} ORDER BY d.created_at DESC, d.rowid DESC LIMIT 1000`,
    )
    .all(...params) as Array<Omit<AuditRow, 'triggered_rules'> & { triggered_rules: string | null }>;
  return rows.map((r) => ({
    ...r,
    triggered_rules: parseJson<Finding[]>(r.triggered_rules, []).filter((x) => x.points > 0).map((x) => x.rule_name),
  }));
}

export const CSV_COLUMNS = ['invoice_id', 'vendor', 'invoice_number', 'amount', 'risk_score', 'risk_level', 'triggered_rules', 'decision', 'reviewer', 'reviewer_note', 'timestamp'] as const;

/** RFC 4180 quoting plus neutralization of spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: AuditRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [r.invoice_id, r.vendor, r.invoice_number, r.amount, r.risk_score, r.risk_level, r.triggered_rules.join('; '), r.decision, r.reviewer, r.reviewer_note, r.timestamp].map(csvCell).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function auditRouter(db: DB): Router {
  const router = Router();
  router.get('/', (req, res, next) => {
    try {
      res.json(queryAudit(db, req.user!, req.query));
    } catch (err) {
      next(err);
    }
  });
  router.get('/export.csv', requireRole('chief_auditor'), (req, res, next) => {
    try {
      const csv = toCsv(queryAudit(db, req.user!, req.query));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="payguard-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });
  return router;
}
