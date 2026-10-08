# PayGuard — CLAUDE.md

Role-controlled, AI-assisted **pre-payment audit gateway** for mid-market AP teams.
Promise: *"PayGuard turns every invoice into an explainable approve, review, or hold decision before money leaves the company."*

This is a **four-hour hackathon MVP**. Prioritize one reliable, complete vertical slice over breadth. Make no production-readiness claims for anything unsupported.

> Status: greenfield build, implemented. Commands below are current. `db:seed` requires `DEMO_PASSWORD`; `.env` is not auto-loaded.

## Scope (exactly three core features)
1. Invoice intake + structured extraction (PDF/PNG/JPG/JPEG, drag-and-drop).
2. Unified duplicate / discrepancy / vendor-and-payment verification (deterministic).
3. Explainable review decision + append-only audit trail + CSV export.

Supporting: role-based auth (Finance Operator, Chief Auditor), historic vendors/invoices/payments DB, risk score, AI extraction, AI explanation card.

**Out of scope — do not build:** ERP/bank integrations, real payments, email ingestion, blockchain, global tax compliance, ML training, chatbot, analytics beyond dashboard tiles, vendor portal, marketing site, billing, procurement.

## Stack (greenfield decision)
- Frontend: React + TypeScript + Vite + Tailwind CSS + Radix-based accessible components.
- Backend: Node 22 + TypeScript + Express, Zod validation on every boundary.
- DB: SQLite via `better-sqlite3`, hand-written SQL migrations, parameterized queries only.
- Auth: server-side sessions (httpOnly, SameSite=Lax cookie), `scrypt` password hashes. No passwords in git.
- Storage: `StorageProvider` interface, local-disk implementation, generated filenames.
- AI: `AiProvider` interface; real provider only when env key present; deterministic fallback otherwise.
- Tests: Vitest (unit + integration against real app + temp SQLite), Playwright (e2e) with executable smoke script as fallback.
- Package manager: npm (workspaces not used; single `package.json`).

## Layout
```
src/                      React app
  components/ pages/ lib/ types/
  features/{auth,dashboard,invoice-upload,invoice-review,audit-trail}/
server/
  index.ts app.ts config.ts db/ (migrations/, client.ts)
  auth/ invoices/ reviews/ audit/
  middleware/{authentication,authorization}/
  storage/
  services/
    invoice-extraction/   AI + fallback, Zod-validated -> InvoiceExtraction
    discrepancy-engine/   deterministic rules -> Finding[]
    risk-scoring/         deterministic weights -> {score, level, workflow}
    explanation/          AI + deterministic fallback, Zod-validated
    ai/                   provider abstraction + ai_logs telemetry
    pipeline/             orchestrates the steps below
scripts/seed/             deterministic seed + demo invoice generator
tests/{unit,integration,e2e}/
```
Never put business logic in React components or a single upload handler. Keep these separate: AI extraction · discrepancy detection · risk scoring · AI explanation · authorization · audit persistence.

## Pipeline
upload → save document → create invoice record → extract → Zod-validate → identify vendor → discrepancy checks → score → explain → persist → review screen.
Loading states shown: Uploading, Extracting, Comparing, Generating explanation.

## Commands (target)
```
npm install
npm run db:migrate          # apply migrations
npm run db:seed             # deterministic seed (needs DEMO_PASSWORD env)
npm run dev                 # API + Vite concurrently
npm run build               # tsc + vite build
npm run typecheck
npm run lint
npm test                    # vitest unit + integration
npm run test:e2e            # playwright (or npm run smoke)
npm run smoke               # executable HTTP smoke test of the full flow
```
Run typecheck, lint, tests and build after each major phase.

## Roles & permissions (enforced server-side; UI hiding is not enough)
| Action | finance_operator | chief_auditor |
|---|---|---|
| Upload, view extraction/findings | yes | yes |
| View all invoices / all audit records | own + shared lists as spec'd | yes |
| Approve / hold / reject-as-duplicate **low & medium** risk | yes | yes |
| Reject – suspected fraud | no | yes |
| Resolve **high** risk (approve/hold/reject) | **no (403)** | yes |
| Export audit CSV | no | yes |
Hold and reject require a non-empty note. Every decision stores authenticated reviewer + timestamp.

## Risk scoring (deterministic, server-side, AI can never change it)
Weights: duplicate (exact or near) +40 · previously-paid match +40 · bank mismatch +30 · unknown vendor +25 · inactive vendor +20 · tax anomaly +15 · price anomaly +15 · PO mismatch +15 · arithmetic mismatch +10. Cap 100.
Levels: 0–29 low · 30–59 medium · 60–100 high.
Each finding: `rule_name, points, severity, evidence, related_record_id|null, values_used_for_comparison`.
Wording: "Potential duplicate detected." / "Payment details do not match the verified vendor record." / "Tax rate differs from historical vendor behavior." / "High risk: payment should be held for verification." **Never** call an invoice definitively fraudulent.

## AI rules
- All AI calls server-side only. No keys in the browser bundle.
- Prompt versions: `invoice_extraction_v1`, `risk_explanation_v1`. Prompts live in code with the spec text.
- Output is strictly Zod-validated (no extra keys, confidence 0–1, nulls for unknowns). Invalid → fallback + `ai_logs` row with `validation_status=failed`.
- Explanation AI may only use supplied evidence; summary <35 words; 1–4 reasons.
- AI must **not** modify vendors, risk score, payment status, approvals, or bank details.
- Every AI op writes an `ai_logs` row: request_id, invoice_id, operation, prompt_version, model_name, latency_ms, validation_status, confidence summary, error_message. Never log keys, full bank numbers, secrets.
- Fallback extraction is only truthful for **seeded demo documents** (matched by embedded marker/hash). Any other upload without a configured provider returns all-null fields + `extraction_status=needs_manual_entry`; never fabricate values.

## Security rules
- Secrets only in env; `.env.example` has placeholders; `.gitignore` covers `.env`, uploads, `*.db*`, logs.
- Validate MIME, extension, magic bytes, size, non-empty; generated storage filenames; SHA-256 duplicate-upload detection.
- Store/display bank **last four digits only**.
- `review_decisions` and `ai_logs` are append-only (no UPDATE/DELETE code paths; SQLite triggers abort them).
- Server-side arithmetic validation; safe text rendering (no `dangerouslySetInnerHTML`); parameterized SQL; no secrets in logs.
- Auth cookies httpOnly; login rate-limited; CSRF mitigated via SameSite + JSON-only mutations.
- No real payment is ever executed.

## Data model
profiles, vendors, purchase_orders, invoices, payments, risk_assessments, review_decisions, ai_logs — fields exactly as in the product spec (plus `invoices.sha256`, `invoices.status`, and session table). Roles: `finance_operator | chief_auditor`. Decision actions: `approve | hold | reject_duplicate | reject_fraud`.

## Seed data (deterministic, seeded PRNG)
25 vendors · ≥100 historic invoices · ≥75 payments · ≥10 POs · historic tax rates and line prices · 4 demo invoices + 1 legitimate-unusual invoice:
1. Normal → low → approve
2. Near-duplicate of a paid invoice → high → reject duplicate
3. Bank suffix mismatch → high → hold
4. Tax/price anomaly → medium/high → review/hold
5. Legitimate unusual (e.g. large but PO-backed) → reviewed, not auto-declared fraud
Demo users: `operator@payguard.demo`, `auditor@payguard.demo` (password from `DEMO_PASSWORD` env at seed time).

## Acceptance criteria (Definition of Done)
- Runs locally with documented commands; auth works; roles enforced server-side.
- PDF/image upload → structured fields displayed → duplicate/discrepancy + vendor/payment checks run.
- Risk score deterministic and explainable; AI explanation schema-validated and logged.
- Review decisions persist; high-risk restricted to Chief Auditor; audit history append-only.
- Audit page with search/filters; CSV export with columns: `invoice_id, vendor, invoice_number, amount, risk_score, risk_level, triggered_rules, decision, reviewer, reviewer_note, timestamp`.
- Four seeded scenarios (+ unusual-legit) work end to end.
- Unit tests (each rule, scoring, level), integration tests (pipeline, authz, append-only, CSV), e2e/smoke (operator approves normal → uploads duplicate → blocked → auditor rejects with note → audit → CSV).
- No secrets committed; README complete (problem, user, promise, architecture, setup, env vars, schema, scoring, prompts, security, demo accounts/scenarios, tests, limitations, roadmap); no unsupported production claims.

## UI
Light neutral bg, navy/charcoal text, indigo primary, green/amber/red for low/medium/high risk, accessible contrast, responsive, no decorative gradients/illustrations. Prioritize the invoice review page. Required errors: invalid file, extraction failed, missing fields, unauthorized action, API/DB failure. No dead buttons or placeholder pages.
