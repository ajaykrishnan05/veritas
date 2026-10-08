import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { DB } from '../db/client.ts';
import { ApiError } from '../http-error.ts';
import { permissionsFor, validateDecision } from '../reviews/policy.ts';
import { DEMO_INVOICES, demoByKey } from '../services/invoice-extraction/demo-fixtures.ts';
import { processInvoice, type PipelineDeps } from '../services/pipeline/index.ts';
import type { StorageProvider } from '../storage/index.ts';
import { getInvoice, parseJson } from './repo.ts';
import { validateUpload } from './validate-upload.ts';
import type { DashboardSummary, DecisionView, InvoiceDetail, InvoiceSummary } from '../../src/types/index.ts';
import fs from 'node:fs';
import path from 'node:path';

const filtersSchema = z.object({
  risk: z.enum(['low', 'medium', 'high']).optional(),
  status: z.enum(['processing', 'pending_review', 'approved', 'held', 'rejected', 'extraction_failed']).optional(),
  vendor: z.string().max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Builds a parameterized WHERE clause from allow-listed filters only. */
function whereFor(query: unknown): { sql: string; params: unknown[] } {
  const f = filtersSchema.safeParse(query);
  if (!f.success) throw new ApiError(400, 'invalid_filter', 'Invalid filter values.');
  const clauses = ["i.source = 'upload'"];
  const params: unknown[] = [];
  if (f.data.risk) { clauses.push('ra.risk_level = ?'); params.push(f.data.risk); }
  if (f.data.status) { clauses.push('i.status = ?'); params.push(f.data.status); }
  if (f.data.vendor) { clauses.push('i.vendor_id = ?'); params.push(f.data.vendor); }
  if (f.data.from) { clauses.push('substr(i.created_at, 1, 10) >= ?'); params.push(f.data.from); }
  if (f.data.to) { clauses.push('substr(i.created_at, 1, 10) <= ?'); params.push(f.data.to); }
  return { sql: clauses.join(' AND '), params };
}

const FROM = `FROM invoices i LEFT JOIN vendors v ON v.id = i.vendor_id LEFT JOIN risk_assessments ra ON ra.invoice_id = i.id`;

const decisionBody = z.object({
  action: z.enum(['approve', 'hold', 'reject_duplicate', 'reject_fraud']),
  note: z.string().max(1000).optional().nullable(),
});

export function invoiceRouter(deps: { db: DB; config: Config; storage: StorageProvider; pipeline: PipelineDeps; demoDir: string }): Router {
  const { db, config, storage, pipeline } = deps;
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

  async function ingest(req: Request, file: { originalname: string; mimetype: string; buffer: Buffer }): Promise<string> {
    const spec = validateUpload(file, config.maxUploadBytes);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const existing = db.prepare("SELECT id FROM invoices WHERE source = 'upload' AND sha256 = ? AND status != 'extraction_failed'").get(sha256) as { id: string } | undefined;
    if (existing) throw new ApiError(409, 'duplicate_upload', 'This exact document has already been uploaded.', { invoice_id: existing.id });
    const key = await storage.save(file.buffer, spec.ext);
    const id = randomUUID();
    // Original filename is stored for display only (never used as a path) and is length-limited.
    db.prepare(
      `INSERT INTO invoices (id, source, uploaded_by, file_path, original_filename, mime_type, sha256, status, processing_stage, created_at)
       VALUES (?, 'upload', ?, ?, ?, ?, ?, 'processing', 'uploaded', ?)`,
    ).run(id, req.user!.id, key, file.originalname.slice(0, 200), spec.mime, sha256, new Date().toISOString());
    return id;
  }

  async function startProcessing(req: Request, id: string): Promise<void> {
    const run = processInvoice(pipeline, id);
    if (req.query.wait === '1') await run;
    else void run;
  }

  router.post('/', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) throw new ApiError(400, 'no_file', 'No file was uploaded. Attach a PDF, PNG, JPG or JPEG.');
      const id = await ingest(req, req.file);
      await startProcessing(req, id);
      res.status(202).json({ id });
    } catch (err) {
      next(err);
    }
  });

  router.get('/demo-documents', (_req, res) => {
    res.json(DEMO_INVOICES.map(({ key, title, scenario, expected, filename }) => ({ key, title, scenario, expected, filename })));
  });

  router.post('/demo/:key', async (req, res, next) => {
    try {
      const demo = demoByKey(String(req.params.key));
      if (!demo) throw new ApiError(404, 'not_found', 'Unknown demo document.');
      const file = path.join(deps.demoDir, demo.filename);
      if (!fs.existsSync(file)) throw new ApiError(500, 'demo_missing', 'Demo documents have not been generated. Run `npm run db:seed`.');
      const id = await ingest(req, { originalname: demo.filename, mimetype: 'application/pdf', buffer: fs.readFileSync(file) });
      await startProcessing(req, id);
      res.status(202).json({ id });
    } catch (err) {
      next(err);
    }
  });

  router.get('/summary', (req, res) => {
    const { sql, params } = whereFor(req.query);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total_invoices,
           COALESCE(SUM(ra.risk_level = 'high'), 0) AS high_risk,
           COALESCE(SUM(i.status = 'pending_review'), 0) AS pending_reviews,
           COALESCE(SUM(CASE WHEN ra.risk_level IN ('medium','high') AND i.status IN ('pending_review','held') THEN i.total_amount END), 0) AS amount_at_risk,
           COALESCE(SUM(CASE WHEN i.status = 'approved' THEN i.total_amount END), 0) AS approved_amount,
           COALESCE(SUM(CASE WHEN i.status = 'held' THEN i.total_amount END), 0) AS held_amount
         ${FROM} WHERE ${sql}`,
      )
      .get(...params) as DashboardSummary;
    res.json(row);
  });

  router.get('/', (req, res) => {
    const { sql, params } = whereFor(req.query);
    const rows = db
      .prepare(
        `SELECT i.id, i.original_filename, i.vendor_id, COALESCE(v.display_name, i.extracted_vendor_name) AS vendor_name, i.invoice_number, i.invoice_date,
           i.total_amount, i.status, i.processing_stage, i.created_at, ra.risk_score, ra.risk_level
         ${FROM} WHERE ${sql} ORDER BY i.created_at DESC LIMIT 200`,
      )
      .all(...params) as InvoiceSummary[];
    res.json(rows);
  });

  router.get('/:id', (req, res, next) => {
    try {
      const inv = getInvoice(db, String(req.params.id));
      if (!inv || inv.source !== 'upload') throw new ApiError(404, 'not_found', 'Invoice not found.');
      const vendor = inv.vendor_id ? (db.prepare('SELECT id, vendor_code, legal_name, display_name, status, verified_bank_last4, approved_tax_rate FROM vendors WHERE id = ?').get(inv.vendor_id) as InvoiceDetail['vendor']) : null;
      const po = inv.purchase_order_number
        ? (db.prepare('SELECT po_number, total_amount, currency, status FROM purchase_orders WHERE lower(po_number) = lower(?)').get(inv.purchase_order_number) as InvoiceDetail['purchase_order'])
        : null;
      const ra = db.prepare('SELECT * FROM risk_assessments WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 1').get(inv.id) as
        | { risk_score: number; risk_level: 'low' | 'medium' | 'high'; triggered_rules: string; comparison_evidence: string; explanation: string; created_at: string }
        | undefined;
      const decisions = db
        .prepare(
          `SELECT d.id, d.invoice_id, d.action, d.reviewer_note, d.reviewer_id, p.full_name AS reviewer_name, d.created_at
           FROM review_decisions d JOIN profiles p ON p.id = d.reviewer_id WHERE d.invoice_id = ? ORDER BY d.created_at ASC, d.rowid ASC`,
        )
        .all(inv.id) as DecisionView[];
      const uploader = inv.uploaded_by ? (db.prepare('SELECT full_name FROM profiles WHERE id = ?').get(inv.uploaded_by) as { full_name: string } | undefined) : undefined;
      const detail: InvoiceDetail = {
        invoice: {
          id: inv.id, original_filename: inv.original_filename, mime_type: inv.mime_type, extraction_status: inv.extraction_status,
          extracted_vendor_name: inv.extracted_vendor_name, invoice_number: inv.invoice_number, invoice_date: inv.invoice_date, subtotal: inv.subtotal,
          tax_rate: inv.tax_rate, tax_amount: inv.tax_amount, total_amount: inv.total_amount, bank_account_last4: inv.bank_account_last4,
          purchase_order_number: inv.purchase_order_number, line_items: parseJson(inv.line_items, []), extraction_confidence: parseJson(inv.extraction_confidence, null),
          status: inv.status, processing_stage: inv.processing_stage, processing_error: inv.processing_error, created_at: inv.created_at,
          uploaded_by_name: uploader?.full_name ?? null,
        },
        vendor,
        purchase_order: po ?? null,
        assessment: ra
          ? {
              risk_score: ra.risk_score, risk_level: ra.risk_level, triggered_rules: parseJson(ra.triggered_rules, []),
              comparison_evidence: parseJson(ra.comparison_evidence, { evidence: [], workflow: 'operator_review_required', related_invoices: [] }),
              explanation: parseJson(ra.explanation, { summary: '', reasons: [], recommended_action: 'review', missing_verification: [] }),
              created_at: ra.created_at,
            }
          : null,
        decisions,
        permissions: permissionsFor(req.user!.role, ra?.risk_level ?? null, inv.status),
      };
      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/document', async (req, res, next) => {
    try {
      const inv = getInvoice(db, String(req.params.id));
      if (!inv?.file_path) throw new ApiError(404, 'not_found', 'Document not found.');
      const bytes = await storage.read(inv.file_path);
      res.setHeader('Content-Type', inv.mime_type);
      res.setHeader('Content-Disposition', 'inline; filename="invoice"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(bytes);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/decisions', (req, res, next) => {
    try {
      const body = decisionBody.safeParse(req.body);
      if (!body.success) throw new ApiError(400, 'invalid_request', 'Invalid decision payload.');
      const note = body.data.note?.trim() || null;
      const user = req.user!;
      const decision = db.transaction(() => {
        const inv = getInvoice(db, String(req.params.id));
        if (!inv || inv.source !== 'upload') throw new ApiError(404, 'not_found', 'Invoice not found.');
        const ra = db.prepare('SELECT risk_level FROM risk_assessments WHERE invoice_id = ?').get(inv.id) as { risk_level: 'low' | 'medium' | 'high' } | undefined;
        validateDecision(user.role, ra?.risk_level ?? null, inv.status, body.data.action, note);
        const id = randomUUID();
        const created_at = new Date().toISOString();
        // Append-only: a new row per decision; earlier decisions are never modified.
        db.prepare('INSERT INTO review_decisions (id, invoice_id, reviewer_id, action, reviewer_note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, inv.id, user.id, body.data.action, note, created_at);
        const status = body.data.action === 'approve' ? 'approved' : body.data.action === 'hold' ? 'held' : 'rejected';
        db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, inv.id);
        return { id, invoice_id: inv.id, action: body.data.action, status, created_at };
      })();
      res.status(201).json(decision);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
