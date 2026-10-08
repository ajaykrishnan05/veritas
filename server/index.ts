import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { migrate, openDb } from './db/client.ts';
import { createProvider } from './services/ai/provider.ts';

const config = loadConfig();
const db = openDb(config.databasePath);
migrate(db);

const provider = createProvider(config);
const app = createApp({ db, config, provider });
app.listen(config.port, () => {
  console.log(`PayGuard API listening on http://localhost:${config.port}`);
  console.log(provider ? `AI provider: ${provider.name} (${provider.model})` : 'AI provider: none configured — using deterministic demo fallback');
});
