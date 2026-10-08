import { loadConfig } from '../config.ts';
import { migrate, openDb } from './client.ts';

const db = openDb(loadConfig().databasePath);
const ran = migrate(db);
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database already up to date.');
