import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashPassword } from '../../server/auth/passwords.ts';
import { loadConfig } from '../../server/config.ts';
import { migrate, openDb, type DB } from '../../server/db/client.ts';
import { DEMO_INVOICES, DEMO_MARKER_PREFIX } from '../../server/services/invoice-extraction/demo-fixtures.ts';
import type { LineItem } from '../../src/types/index.ts';
import { buildPdf } from './pdf.ts';
import { VENDORS, catalogFor } from './vendors.ts';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Deterministic PRNG so every seed run produces identical data. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const SEEDED_AT = '2025-01-01T00:00:00.000Z';

export interface SeedResult {
  vendors: number;
  invoices: number;
  payments: number;
  purchaseOrders: number;
}

export function seedDatabase(db: DB, demoPassword: string): SeedResult {
  const rand = mulberry32(20260601);
  const vendorId = (i: number) => `ven-${String(i + 1).padStart(3, '0')}`;
  const counts: SeedResult = { vendors: 0, invoices: 0, payments: 0, purchaseOrders: 0 };

  db.transaction(() => {
    const insProfile = db.prepare('INSERT INTO profiles (id, full_name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    insProfile.run('user-operator', 'Olivia Operator', 'operator@payguard.demo', 'finance_operator', hashPassword(demoPassword), SEEDED_AT);
    insProfile.run('user-auditor', 'Adrian Auditor', 'auditor@payguard.demo', 'chief_auditor', hashPassword(demoPassword), SEEDED_AT);

    const insVendor = db.prepare(
      `INSERT INTO vendors (id, vendor_code, legal_name, display_name, tax_id, verified_bank_last4, approved_tax_rate, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    VENDORS.forEach((v, i) => {
      insVendor.run(vendorId(i), v.code, v.legal, v.display, `99-${String(1000000 + i * 7919).slice(0, 7)}`, v.bank, v.taxRate, v.status, SEEDED_AT, SEEDED_AT);
      counts.vendors++;
    });

    const insPo = db.prepare('INSERT INTO purchase_orders (id, po_number, vendor_id, total_amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let n = 1; n <= 12; n++) {
      const total = n === 3 ? 2400 : n === 5 ? 3000 : 5000 + n * 1250;
      insPo.run(`po-${n}`, `PO-2026-${String(n).padStart(4, '0')}`, vendorId(n - 1), total, 'USD', 'open', '2026-01-05T00:00:00.000Z');
      counts.purchaseOrders++;
    }

    const insInvoice = db.prepare(
      `INSERT INTO invoices (id, source, uploaded_by, file_path, original_filename, mime_type, vendor_id, extracted_vendor_name, invoice_number, invoice_date, subtotal, tax_rate,
         tax_amount, total_amount, bank_account_last4, purchase_order_number, line_items, extraction_status, status, processing_stage, created_at)
       VALUES (?, 'historic', 'user-operator', NULL, ?, 'application/pdf', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'complete', 'approved', 'done', ?)`,
    );
    const insPayment = db.prepare('INSERT INTO payments (id, invoice_id, vendor_id, amount_paid, payment_date, bank_account_last4, status) VALUES (?, ?, ?, ?, ?, ?, ?)');

    let seq = 0;
    const addHistoric = (vi: number, number: string, date: string, lines: LineItem[], paymentStatus: 'paid' | 'pending' | 'cancelled' | null, id?: string) => {
      const v = VENDORS[vi];
      const rate = v.taxRate ?? 7;
      const subtotal = round2(lines.reduce((s, l) => s + (l.amount ?? 0), 0));
      const tax = round2((subtotal * rate) / 100);
      const total = round2(subtotal + tax);
      const invId = id ?? `inv-${String(++seq).padStart(4, '0')}`;
      insInvoice.run(invId, `${number}.pdf`, vendorId(vi), v.legal, number, date, subtotal, rate, tax, total, v.bank, JSON.stringify(lines), `${date}T09:00:00.000Z`);
      counts.invoices++;
      if (paymentStatus) {
        insPayment.run(`pay-${invId}`, invId, vendorId(vi), total, addDays(date, 25), v.bank, paymentStatus);
        counts.payments++;
      }
    };

    // 6 historic invoices per vendor, covering all three catalog items at least 3 times each.
    const INVOICE_ITEMS = [[0, 1], [1], [2, 0], [0], [1, 2], [2]];
    VENDORS.forEach((v, vi) => {
      const catalog = catalogFor(vi);
      INVOICE_ITEMS.forEach((itemIdx, j) => {
        const lines: LineItem[] = itemIdx.map((k) => {
          const qty = 1 + Math.floor(rand() * 12);
          const price = round2(catalog[k][1] * (0.98 + rand() * 0.04));
          return { description: catalog[k][0], quantity: qty, unit_price: price, amount: round2(qty * price) };
        });
        const date = addDays('2025-01-10', Math.floor(j * 80 + vi * 3 + rand() * 10));
        const idx = seq + 1;
        const payment = idx % 8 === 0 ? null : idx % 37 === 0 ? 'cancelled' : idx % 11 === 0 ? 'pending' : 'paid';
        addHistoric(vi, `INV-${v.code}-${1000 + idx}`, date, lines, payment);
      });
    });

    // Anchor invoice: the already-paid original that demo scenario 2 resubmits under a new number.
    addHistoric(
      1, 'INV-BRL-3302', '2026-06-02',
      [
        { description: 'Pallet freight, regional', quantity: 6, unit_price: 185, amount: 1110 },
        { description: 'Last-mile delivery, per stop', quantity: 40, unit_price: 14.75, amount: 590 },
      ],
      'paid', 'inv-dup-anchor',
    );
  })();
  return counts;
}

export function writeDemoPdfs(dir: string): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const money = (n: number | null) => (n == null ? '' : n.toFixed(2));
  return DEMO_INVOICES.map((d) => {
    const x = d.extraction;
    const pdf = buildPdf(
      [
        { text: x.vendor_name ?? '', size: 18, bold: true },
        { text: 'INVOICE', size: 14, bold: true },
        { text: `Invoice number: ${x.invoice_number}` },
        { text: `Invoice date: ${x.invoice_date}` },
        { text: x.purchase_order_number ? `Purchase order: ${x.purchase_order_number}` : 'Purchase order: -' },
        { text: '' },
        { text: 'Description                                   Qty      Unit price      Amount', bold: true },
        ...x.line_items.map((l) => ({ text: `${l.description}      ${l.quantity}      ${money(l.unit_price)}      ${money(l.amount)}` })),
        { text: '' },
        { text: `Subtotal: ${money(x.subtotal)}` },
        { text: `Tax (${x.tax_rate}%): ${money(x.tax_amount)}` },
        { text: `Total due: ${money(x.total_amount)}`, bold: true },
        { text: '' },
        { text: `Remit to bank account ending ${x.bank_account_last4}` },
        { text: 'Synthetic demo document generated by PayGuard. Not a real invoice.', size: 8 },
      ],
      `${DEMO_MARKER_PREFIX}${d.key}`,
    );
    const file = path.join(dir, d.filename);
    fs.writeFileSync(file, pdf);
    return file;
  });
}

function main() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) {
    console.error('Set DEMO_PASSWORD (min 8 characters) in your environment to seed demo users, e.g.\n  DEMO_PASSWORD="choose-a-local-password" npm run db:seed');
    process.exit(1);
  }
  const config = loadConfig();
  if (process.argv.includes('--reset')) {
    for (const f of [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`]) fs.rmSync(f, { force: true });
    fs.rmSync(config.uploadDir, { recursive: true, force: true });
  }
  const db = openDb(config.databasePath);
  migrate(db);
  const existing = db.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number };
  if (existing.n > 0) {
    console.error('Database already seeded. Run `npm run db:seed -- --reset` to wipe local data and re-seed.');
    process.exit(1);
  }
  const r = seedDatabase(db, password);
  const files = writeDemoPdfs(path.resolve('demo-invoices'));
  console.log(`Seeded ${r.vendors} vendors, ${r.invoices} historic invoices, ${r.payments} payments, ${r.purchaseOrders} purchase orders.`);
  console.log(`Wrote ${files.length} demo invoices to ./demo-invoices. Demo users: operator@payguard.demo, auditor@payguard.demo`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
