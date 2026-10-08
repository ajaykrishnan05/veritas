import { z } from 'zod';

const nullableNumber = z.number().finite().nullable();
const confidenceValue = z.number().min(0).max(1);

const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

export const extractionSchema = z
  .object({
    vendor_name: z.string().min(1).max(200).nullable(),
    invoice_number: z.string().min(1).max(100).nullable(),
    invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, 'invalid calendar date').nullable(),
    subtotal: nullableNumber,
    tax_rate: z.number().finite().min(0).max(100).nullable(),
    tax_amount: nullableNumber,
    total_amount: nullableNumber,
    bank_account_last4: z.string().regex(/^\d{4}$/).nullable(),
    purchase_order_number: z.string().min(1).max(100).nullable(),
    line_items: z
      .array(
        z
          .object({
            description: z.string().max(300),
            quantity: nullableNumber,
            unit_price: nullableNumber,
            amount: nullableNumber,
          })
          .strict(),
      )
      .max(200),
    confidence: z
      .object({
        vendor_name: confidenceValue,
        invoice_number: confidenceValue,
        invoice_date: confidenceValue,
        total_amount: confidenceValue,
        tax_rate: confidenceValue,
      })
      .strict(),
  })
  .strict();

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
// An explanation must not state fraud as fact.
const FRAUD_CERTAINTY = /\b(fraudulent|is (a )?fraud|was (a )?fraud|definitely|certainly fraud|clearly fraud|confirmed fraud)\b/i;

export const explanationSchema = z
  .object({
    summary: z.string().min(1).refine((s) => wordCount(s) < 35, 'summary must be under 35 words'),
    reasons: z.array(z.string().min(1).max(500)).min(1).max(4),
    recommended_action: z.enum(['approve', 'review', 'hold']),
    missing_verification: z.array(z.string().max(300)).max(8),
  })
  .strict()
  .refine((e) => ![e.summary, ...e.reasons, ...e.missing_verification].some((t) => FRAUD_CERTAINTY.test(t)), 'must not assert fraud as certain');
