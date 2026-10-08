/**
 * HTTP smoke test of the full flow against a running server (no browser needed).
 *   DEMO_PASSWORD=... BASE_URL=http://localhost:3001 npm run smoke
 * Run on a freshly seeded database: it processes the demo documents, which are rejected as duplicate uploads on a second run.
 */
export {};

interface Finding { rule_name: string }
interface Detail { assessment: { risk_level: string; risk_score: number; triggered_rules: Finding[] } }

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) {
  console.error('Set DEMO_PASSWORD to the password used when seeding.');
  process.exit(1);
}

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failures++;
};

async function client(email: string) {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'X-PayGuard-CSRF': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, json, text };
  };
  const login = await call('POST', '/auth/login', { email, password: PASSWORD });
  if (login.status !== 200) throw new Error(`Login failed for ${email}: ${login.status}`);
  return call;
}

const operator = await client('operator@payguard.demo');
const auditor = await client('auditor@payguard.demo');

// Normal invoice → low → operator approves
const normal = (await operator('POST', '/invoices/demo/normal?wait=1')).json.id;
let d: Detail = (await operator('GET', `/invoices/${normal}`)).json as Detail;
check('normal invoice is low risk', d.assessment.risk_level === 'low' && d.assessment.risk_score === 0);
check('operator can approve low risk', (await operator('POST', `/invoices/${normal}/decisions`, { action: 'approve' })).status === 201);

// Duplicate → high → operator blocked → auditor rejects with note
const dup = (await operator('POST', '/invoices/demo/duplicate?wait=1')).json.id;
d = (await operator('GET', `/invoices/${dup}`)).json as Detail;
check('duplicate is high risk with a duplicate finding', d.assessment.risk_level === 'high' && d.assessment.triggered_rules.some((r) => r.rule_name === 'duplicate'));
check('operator cannot resolve high risk (403)', (await operator('POST', `/invoices/${dup}/decisions`, { action: 'approve', note: 'x' })).status === 403);
check('reject requires a note (400)', (await auditor('POST', `/invoices/${dup}/decisions`, { action: 'reject_duplicate' })).status === 400);
check('auditor can reject duplicate with note', (await auditor('POST', `/invoices/${dup}/decisions`, { action: 'reject_duplicate', note: 'Duplicate of paid INV-BRL-3302' })).status === 201);

// Other scenarios
for (const [key, level] of [['bank-mismatch', 'high'], ['tax-price-anomaly', 'medium'], ['legit-unusual', 'medium']] as const) {
  const id = (await operator('POST', `/invoices/demo/${key}?wait=1`)).json.id;
  const r = (await operator('GET', `/invoices/${id}`)).json;
  check(`${key} is ${level} risk`, r.assessment.risk_level === level, `got ${r.assessment?.risk_level}`);
}

// Audit + CSV
const audit = await auditor('GET', '/audit');
check('audit trail lists decisions', audit.json.length >= 2);
const csv = await auditor('GET', '/audit/export.csv');
check('auditor can export CSV', csv.status === 200 && csv.text.startsWith('invoice_id,vendor,invoice_number,amount,risk_score,risk_level,triggered_rules,decision,reviewer,reviewer_note,timestamp'));
check('operator cannot export CSV (403)', (await operator('GET', '/audit/export.csv')).status === 403);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
