export const EXTRACTION_PROMPT_VERSION = 'invoice_extraction_v1';
export const EXPLANATION_PROMPT_VERSION = 'risk_explanation_v1';

export const EXTRACTION_PROMPT = `Extract invoice information from the attached document.

Return valid JSON only:

{
  "vendor_name": "string|null",
  "invoice_number": "string|null",
  "invoice_date": "YYYY-MM-DD|null",
  "subtotal": "number|null",
  "tax_rate": "number|null",
  "tax_amount": "number|null",
  "total_amount": "number|null",
  "bank_account_last4": "string|null",
  "purchase_order_number": "string|null",
  "line_items": [
    {
      "description": "string",
      "quantity": "number|null",
      "unit_price": "number|null",
      "amount": "number|null"
    }
  ],
  "confidence": {
    "vendor_name": "number",
    "invoice_number": "number",
    "invoice_date": "number",
    "total_amount": "number",
    "tax_rate": "number"
  }
}

Rules:
- Do not guess.
- Use null when missing or unreadable.
- Return numbers as numbers.
- Do not return markdown.
- Do not return extra keys.
- Do not infer an invisible bank account.
- Confidence values must be between 0 and 1.
- tax_rate is a percentage number (8.5 means 8.5%).`;

export const EXPLANATION_PROMPT = `Generate a concise finance-review explanation from the verified findings.

Return valid JSON only:

{
  "summary": "string",
  "reasons": ["string"],
  "recommended_action": "approve|review|hold",
  "missing_verification": ["string"]
}

Rules:
- Use only supplied evidence.
- Do not invent facts.
- Do not claim fraud as a certainty.
- Do not change the risk score.
- Keep summary under 35 words.
- Return 1 to 4 reasons.
- Recommend approve for low risk, review for medium risk, and hold for high risk unless evidence clearly supports another action.`;
