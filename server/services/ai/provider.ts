import type { Config } from '../../config.ts';

export interface AiDocument {
  bytes: Buffer;
  mime: string;
}

/** Server-side AI provider. Implementations return raw model text; callers validate it. */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  extractInvoice(doc: AiDocument, prompt: string): Promise<string>;
  explain(prompt: string, evidence: unknown): Promise<string>;
}

type FetchFn = typeof fetch;

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async complete(content: unknown[], system?: string): Promise<string> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: 2048, temperature: 0, system, messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      // Never include headers or the key in the error.
      throw new Error(`AI provider returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === 'text')?.text;
    if (!text) throw new Error('AI provider returned no text content');
    return text;
  }

  extractInvoice(doc: AiDocument, prompt: string): Promise<string> {
    const data = doc.bytes.toString('base64');
    const block =
      doc.mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: doc.mime, data } };
    return this.complete([block, { type: 'text', text: prompt }]);
  }

  explain(prompt: string, evidence: unknown): Promise<string> {
    return this.complete([{ type: 'text', text: `${prompt}\n\nVerified findings (JSON):\n${JSON.stringify(evidence)}` }]);
  }
}

/** Returns a real provider only when an API key is configured; otherwise null (deterministic fallback). */
export function createProvider(config: Pick<Config, 'anthropicApiKey' | 'anthropicBaseUrl' | 'aiModel'>, fetchFn?: FetchFn): AiProvider | null {
  if (!config.anthropicApiKey) return null;
  return new AnthropicProvider(config.anthropicApiKey, config.aiModel, config.anthropicBaseUrl, fetchFn);
}
