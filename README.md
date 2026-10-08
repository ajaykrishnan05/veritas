# PayGuard

**PayGuard turns every invoice into an explainable approve, review, or hold decision before money leaves the company.**

A hackathon MVP of a role-controlled, AI-assisted pre-payment audit gateway. It does not move money, integrate with banks or ERPs, or make autonomous payment decisions.

## Problem and primary user

An Accounts Payable operator processes hundreds of vendor invoices and cannot manually compare each one with vendor history, previous payments, tax rates, line-item prices, purchase orders and bank details. Duplicate payments, changed bank details and inflated prices slip through.

PayGuard accepts an invoice (PDF/PNG/JPG), extracts structured fields, compares them with trusted history, scores the risk with transparent fixed rules, explains the evidence in plain language, routes the invoice to approve / review / hold, records every decision in an append-only audit trail and exports it as CSV.

## Quick start

Requirements: Node 22+ and npm.

```bash
npm install
cp .env.example .env            # optional; defaults work for local use
export DEMO_PASSWORD="choose-a-local-password"   # used only to hash the demo users' passwords
npm run db:seed                 # creates ./data/payguard.db and ./demo-invoices/*.pdf (use `-- --reset` to re-seed)
npm run dev                     # API on :3001, UI on http://localhost:5173
```

Or run the production build on a single port: `npm run build && npm start` → http://localhost:3001.

> `.env` is not loaded automatically; export variables in your shell (or use `node --env-file=.env`). Real passwords and API keys must never be committed.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Finance Operator | `operator@payguard.demo` | the `DEMO_PASSWORD` you seeded with |
| Chief Auditor | `auditor@payguard.demo` | the `DEMO_PASSWORD` you seeded with |

### Environment variables

| Name | Purpose | Default |
|---|---|---|
| `PORT` | API port | `3001` |
| `DATABASE_PATH` | SQLite file | `./data/payguard.db` |
| `UPLOAD_DIR` | Uploaded-document directory (files get generated names) | `./data/uploads` |
| `MAX_UPLOAD_MB` | Upload size limit | `10` |
| `DEMO_PASSWORD` | Required by `db:seed` only (min 8 chars) | – |
| `ANTHROPIC_API_KEY` | Enables the real multimodal AI provider (server-side only). Blank = deterministic fallback | blank |
| `AI_MODEL` | Model id for the provider | `claude-sonnet-5-5` |
| `ANTHROPIC_BASE_URL` | Optional API base URL override | `https://api.anthropic.com` |

## Demo scenarios

On the **Upload invoice** page, “Demo documents” run five synthetic PDFs through the same pipeline (the same files are in `demo-invoices/` and can be dragged in).

| # | Document | Expected result |
|---|---|---|
| 1 | Apex Office Supplies, routine order | Low risk (0). Operator approves. |
| 2 | Brightline Logistics, same lines/total as a paid June invoice under a new number | High (80): duplicate + previously paid. Operator is blocked; Chief Auditor rejects as duplicate. |
| 3 | Cobalt IT Services, bank suffix differs from verified record | High (60): bank mismatch + above PO + higher rate. Chief Auditor holds. |
| 4 | Delta Facility Maintenance, tax rate and call-out price high, unknown PO | Medium (45). Review or hold. |
| 5 | Evergreen Printing, PO-backed, matching bank, lower tax rate and a price-list increase | Medium (30). Flagged for review, **not** treated as fraud; operator approves with a note. |

Note on scenario 3: under the specified weights a bank mismatch alone is 30 points, which is *medium*. The demo document therefore also exceeds its PO and carries higher unit prices so the combined score reaches *high*, as a real changed-bank-details attack often would.

Suggested walkthrough: sign in as the operator → process #1 → approve → process #2 → observe the high-risk finding and that no action is available → sign out → sign in as the auditor → reject #2 with a note → **Audit trail** → **Export CSV**.

## Architecture

```
src/                       React + TypeScript + Vite + Tailwind (Radix Tabs)
  pages/ features/ components/ lib/ types/
server/                    Express + TypeScript
  auth/ middleware/        sessions, authentication, role authorization
  invoices/ reviews/ audit/  routers, upload validation, decision policy, CSV export
  storage/                 StorageProvider (local disk, generated filenames)
  db/                      SQLite (better-sqlite3), SQL migrations
  services/
    invoice-extraction/    AI extraction + deterministic demo fallback → InvoiceExtraction
    discrepancy-engine/    deterministic rules → findings
    risk-scoring/          deterministic weights → score, level, workflow
    explanation/           AI explanation + deterministic fallback
    ai/                    AiProvider abstraction, prompts, Zod schemas, ai_logs telemetry
    pipeline/              orchestrates the steps
scripts/seed/              deterministic seed + demo PDF generator
tests/{unit,integration,e2e}
```

Pipeline: `upload → save document → create invoice record → extract → validate schema → identify vendor → discrepancy checks → score → explain → persist → review screen`. Processing runs in the background; the UI shows the server-reported stage (Uploading, Extracting, Comparing, Generating explanation).

Separation of concerns: AI extraction, deterministic discrepancy detection, deterministic scoring, AI explanation, authorization and audit persistence are separate modules. **AI never sets the score, vendor records, bank details, payment status or decisions.**

### Extraction without an AI key

With no `ANTHROPIC_API_KEY`, extraction uses a deterministic fallback that **only recognizes the seeded demo PDFs** (they embed a `PAYGUARD-DEMO:<key>` marker mapped to fixture values). Any other document ends as `needs_manual_entry` with all fields empty: values are never guessed. The fallback output uses the same schema and goes through the same discrepancy engine and scorer.

## Database schema

SQLite tables (see `server/db/migrations/001_init.sql`): `profiles`, `vendors`, `purchase_orders`, `invoices`, `payments`, `risk_assessments`, `review_decisions`, `ai_logs` (fields as in the product spec), plus:
- `sessions` (hashed session tokens) and `profiles.password_hash` (scrypt).
- `invoices.sha256` (duplicate-upload detection), `source` (`upload` | `historic`), `status`, `processing_stage`, `processing_error`, `mime_type`.

Only the last four digits of bank accounts are stored or displayed. `review_decisions`, `ai_logs` and `risk_assessments` are append-only: SQLite triggers abort `UPDATE`/`DELETE`, and no API route edits them. `invoices.status` is a cache of the latest decision; the decision history is the source of truth.

Seed (deterministic PRNG): 25 vendors (2 inactive, 1 pending, one near-duplicate vendor name), 151 historic invoices, 133 payments, 12 purchase orders, historic tax rates and line-item prices, plus 5 demo PDFs.

## Risk scoring

Deterministic code in `server/services/risk-scoring` and `server/services/discrepancy-engine`.

| Rule | Points |
|---|---|
| Exact or near duplicate | +40 |
| Previously paid match | +40 |
| Bank mismatch | +30 |
| Unknown vendor | +25 |
| Inactive vendor | +20 |
| Tax anomaly | +15 |
| Price anomaly | +15 |
| PO mismatch | +15 |
| Arithmetic mismatch | +10 |

Score is capped at 100. **0–29 low · 30–59 medium · 60–100 high.** Every finding carries `rule_name, points, severity, evidence, related_record_id, values_used_for_comparison`.

Thresholds (`THRESHOLDS` in the engine): vendor name match ≥ 0.85 bigram similarity; near-duplicate = same vendor, total within 2%, date within 14 days, line-item similarity ≥ 0.6; exact duplicate = same vendor and invoice number with total within 1%; tax differs from the approved (or most common historic) rate by > 0.5 points; price ≥ 25% above the vendor's historic average for that item (needs ≥ 2 historic samples); arithmetic tolerance max($0.05, 0.1%).

Vendor-name mismatch, similar vendor names and pending vendors are reported as **0-point informational findings** because the specified weights define no points for them.

### Workflow rules (enforced server-side)

| | Finance Operator | Chief Auditor |
|---|---|---|
| Upload, view extraction and findings | yes | yes |
| Low / medium risk: approve, hold, reject as duplicate | yes | yes |
| Reject – suspected fraud | no | yes |
| **High risk: resolve** | **no (403)** | yes |
| Audit trail | own decisions | all |
| CSV export | no (403) | yes |

Hold, reject, and approving a medium/high-risk invoice require a reviewer note. Resolved (approved/rejected) invoices are final; held invoices can receive a follow-up decision (a new appended record). Approving never creates a payment.

## AI prompts and versions

- `invoice_extraction_v1`: extraction prompt (`server/services/ai/prompts.ts`). One line was added to the specified rules: “tax_rate is a percentage number (8.5 means 8.5%)”.
- `risk_explanation_v1`: explanation prompt from the spec.

Outputs are parsed as strict JSON (markdown fences rejected) and validated with Zod (`.strict()`, confidence 0–1, valid dates, last-four format, summary < 35 words, 1–4 reasons). Explanations that assert fraud as fact, or recommend a weaker action than the deterministic risk level requires, are rejected and replaced by a deterministic explanation. Every AI operation writes an `ai_logs` row (request_id, invoice_id, operation, prompt_version, model_name, latency_ms, validation_status `passed|failed|fallback`, non-sensitive input metadata incl. mean confidence, error message). Keys, headers and full bank numbers are never logged.

## Security decisions

- Authorization is enforced in the API (`requireRole`, `permissionsFor`/`validateDecision`); the UI only mirrors it.
- httpOnly, SameSite=Lax session cookies (`Secure` in production); scrypt password hashes; constant-work login for unknown emails; in-memory login throttle (10 failures / 15 min / email+IP).
- All mutating API calls require an `X-PayGuard-CSRF` header (in addition to SameSite).
- Uploads: extension + declared MIME + magic bytes + size + empty/corrupt checks; generated storage names; SHA-256 duplicate-upload detection; documents served only to signed-in users with `nosniff`.
- Parameterized SQL only; filters are allow-listed and validated with Zod; `LIKE` wildcards escaped.
- CSV export neutralizes spreadsheet formula injection.
- React escapes all rendered text; `dangerouslySetInnerHTML` is lint-forbidden.
- Strict CSP and security headers; no secrets in the frontend bundle (AI calls are server-side only).
- Secrets only via environment; `.env`, databases, uploads and logs are git-ignored.

## Tests

```bash
npm run typecheck && npm run lint
npm test                 # Vitest: unit (every rule, scoring, levels) + integration (pipeline, authz, append-only, CSV, AI paths)
npm run test:e2e         # Playwright: full operator→auditor flow in Chromium (builds + seeds a throwaway DB on :3101)
npm run smoke            # HTTP smoke test against a running server on a freshly seeded DB:
                         #   DEMO_PASSWORD=... BASE_URL=http://localhost:3001 npm run smoke
```

`PLAYWRIGHT_CHROMIUM_PATH` overrides the browser executable (defaults to `/opt/pw-browsers/chromium` when present, otherwise Playwright's own install).

## Known limitations

- Without an AI key, only the seeded demo documents can be extracted. The real-provider path (Anthropic Messages API) is implemented and covered by tests using a stubbed `fetch`, but **has not been exercised against the live API** in this build.
- Single-node SQLite and local-disk storage; not designed for concurrent multi-instance deployment.
- No manual field-entry/correction UI, vendor management UI, user management or password reset.
- Login throttling is in-memory (resets on restart).
- PO checks compare an invoice against the PO total only (no running PO balance). Duplicate/price heuristics are simple and tunable, not trained models.
- Currency is assumed to be USD for display.
- Only one assessment per invoice; there is no re-assessment flow.
- This is decision support, not a compliance or fraud-detection guarantee, and has had no security review beyond the measures listed above.

## Future roadmap

Manual extraction correction, PO balance tracking, vendor onboarding and bank-change workflows, multi-currency, Postgres/Supabase with row-level security, queue-based processing, configurable thresholds per vendor, ERP/AP export, SSO.
