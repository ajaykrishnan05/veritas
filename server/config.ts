import path from 'node:path';

export interface Config {
  port: number;
  nodeEnv: string;
  databasePath: string;
  uploadDir: string;
  maxUploadBytes: number;
  anthropicApiKey: string | null;
  anthropicBaseUrl: string;
  aiModel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3001),
    nodeEnv: env.NODE_ENV ?? 'development',
    databasePath: path.resolve(env.DATABASE_PATH ?? './data/payguard.db'),
    uploadDir: path.resolve(env.UPLOAD_DIR ?? './data/uploads'),
    maxUploadBytes: Math.max(1, Math.floor(Number(env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024)),
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    anthropicBaseUrl: (env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com').replace(/\/$/, ''),
    aiModel: env.AI_MODEL?.trim() || 'claude-sonnet-5-5',
  };
}
