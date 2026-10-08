import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PASSWORD = 'e2e-demo-password';

async function signIn(page: Page, who: 'operator' | 'auditor') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@payguard.demo`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('operator → auditor full flow: approve, duplicate blocked, auditor rejects, audit trail, CSV', async ({ page }) => {
  // 1. Login as Finance Operator (and rejects bad credentials)
  await page.goto('/login');
  await page.getByLabel('Email').fill('operator@payguard.demo');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password');
  await signIn(page, 'operator');
  await expect(page.getByText('No invoices have been processed yet.')).toBeVisible();

  // 2. Upload normal invoice (demo document → same pipeline)
  await page.getByRole('link', { name: 'Upload invoice' }).first().click();
  await page.getByRole('button', { name: /Process this demo: Apex Office Supplies/ }).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: /INV-APX-7001/ })).toBeVisible();
  await expect(page.getByText('Low risk: no significant discrepancies')).toBeVisible();

  // 3. Approve low-risk invoice
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Decision recorded:')).toBeVisible();
  await expect(page.getByText('already approved')).toBeVisible();

  // Invalid file shows an error and nothing is uploaded
  await page.goto('/upload');
  await page.getByLabel('Invoice file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByRole('alert')).toContainText('Invalid file');

  // 4. Upload the duplicate through the real file-upload path
  await page.getByLabel('Invoice file').setInputFiles(path.resolve('demo-invoices/demo-2-duplicate-brightline.pdf'));
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);

  // 5. High-risk finding is shown with evidence
  await expect(page.getByText('High risk: payment should be held for verification.')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Findings/ })).toBeVisible();
  await expect(page.getByText(/Potential duplicate detected/).first()).toBeVisible();
  await page.getByRole('tab', { name: /Vendor & history/ }).click();
  await expect(page.getByRole('cell', { name: 'INV-BRL-3302', exact: true })).toBeVisible();
  const duplicateUrl = page.url();

  // 6. Finance Operator cannot resolve it (UI and server)
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect(page.getByText('High-risk invoices can only be resolved by a Chief Auditor.')).toBeVisible();
  const invoiceId = duplicateUrl.split('/').pop();
  const forced = await page.request.post(`/api/invoices/${invoiceId}/decisions`, { headers: { 'X-PayGuard-CSRF': '1' }, data: { action: 'approve', note: 'bypass attempt' } });
  expect(forced.status()).toBe(403);
  const exportAttempt = await page.request.get('/api/audit/export.csv');
  expect(exportAttempt.status()).toBe(403);

  // 7. Login as Chief Auditor
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to PayGuard' })).toBeVisible();
  await signIn(page, 'auditor');
  await page.goto(duplicateUrl);

  // 8. Reject as duplicate: a note is required
  await page.getByRole('button', { name: 'Reject as duplicate' }).click();
  await expect(page.getByRole('alert')).toContainText('reviewer note');
  await page.getByLabel(/Reviewer note/).fill('Duplicate of INV-BRL-3302, already paid in June.');
  await page.getByRole('button', { name: 'Reject as duplicate' }).click();
  await expect(page.getByText('Decision recorded:')).toBeVisible();
  await page.getByRole('tab', { name: /Review history/ }).click();
  await expect(page.getByText('Duplicate of INV-BRL-3302, already paid in June.')).toBeVisible();

  // 9. Audit trail
  await page.getByRole('link', { name: 'Audit trail' }).click();
  await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();
  await expect(page.getByRole('row', { name: /BL-3302A.*Reject as duplicate.*Adrian Auditor/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /INV-APX-7001.*Approve.*Olivia Operator/ })).toBeVisible();
  await page.getByLabel('Search').fill('brightline');
  await expect(page.getByText('1 record')).toBeVisible();
  await page.getByLabel('Search').fill('');
  await expect(page.getByText('2 records')).toBeVisible();

  // 10. Export CSV
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^payguard-audit-\d{4}-\d{2}-\d{2}\.csv$/);
  const file = await download.path();
  const csv = fs.readFileSync(file!, 'utf8').trim().split('\r\n');
  expect(csv[0]).toBe('invoice_id,vendor,invoice_number,amount,risk_score,risk_level,triggered_rules,decision,reviewer,reviewer_note,timestamp');
  expect(csv).toHaveLength(3);
  expect(csv.join('\n')).toContain('reject_duplicate');

  // Dashboard reflects the outcome
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByText('Invoices processed')).toBeVisible();
  await page.getByLabel('Risk level').selectOption('high');
  await expect(page.getByRole('row', { name: /Brightline/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Apex/ })).toHaveCount(0);
});

test('unauthenticated users are redirected to login', async ({ page }) => {
  await page.goto('/audit');
  await expect(page).toHaveURL(/\/login$/);
});
