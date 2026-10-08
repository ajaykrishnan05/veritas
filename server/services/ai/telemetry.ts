import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/client.ts';

export interface AiTelemetry {
  operation: 'extraction' | 'explanation';
  prompt_version: string;
  model_name: string;
  latency_ms: number;
  /** passed | failed | fallback */
  validation_status: 'passed' | 'failed' | 'fallback';
  error_message: string | null;
  /** Non-sensitive metadata only (no raw bank details, no secrets). */
  input_metadata: Record<string, unknown>;
}

export function logAiOperation(db: DB, requestId: string, invoiceId: string | null, t: AiTelemetry): void {
  db.prepare(
    `INSERT INTO ai_logs (id, invoice_id, request_id, operation, prompt_version, model_name, latency_ms, input_metadata, validation_status, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    invoiceId,
    requestId,
    t.operation,
    t.prompt_version,
    t.model_name,
    Math.round(t.latency_ms),
    JSON.stringify(t.input_metadata),
    t.validation_status,
    t.error_message ? t.error_message.slice(0, 500) : null,
    new Date().toISOString(),
  );
}
