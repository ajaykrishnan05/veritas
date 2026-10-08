const CORPORATE_SUFFIXES = new Set(['llc', 'inc', 'ltd', 'limited', 'co', 'corp', 'corporation', 'company', 'group', 'plc']);

/** Lowercase alphanumerics only; used for exact-name comparisons. */
export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Lowercase words with corporate suffixes removed; used for fuzzy comparisons. */
export function normalizeWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !CORPORATE_SUFFIXES.has(w))
    .join(' ');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, ' ');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity of character bigrams on normalized words (0..1). */
export function similarity(a: string, b: string): number {
  const x = normalizeWords(a);
  const y = normalizeWords(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  let total = 0;
  for (const [g, c] of bx) {
    total += c;
    overlap += Math.min(c, by.get(g) ?? 0);
  }
  for (const c of by.values()) total += c;
  return total === 0 ? 0 : (2 * overlap) / total;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function daysBetween(a: string, b: string): number | null {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.abs(da - db) / 86_400_000;
}

export const money = (n: number | null | undefined): string =>
  n == null ? 'n/a' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
