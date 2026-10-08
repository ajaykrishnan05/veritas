import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface StorageProvider {
  /** Stores bytes under a generated name and returns the storage key. */
  save(bytes: Buffer, ext: string): Promise<string>;
  read(key: string): Promise<Buffer>;
}

const KEY_PATTERN = /^[0-9a-f-]{36}\.(pdf|png|jpg)$/;

export class LocalStorage implements StorageProvider {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  async save(bytes: Buffer, ext: string): Promise<string> {
    const key = `${randomUUID()}.${ext}`;
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage extension');
    await fs.promises.writeFile(path.join(this.dir, key), bytes, { flag: 'wx', mode: 0o600 });
    return key;
  }

  async read(key: string): Promise<Buffer> {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
    return fs.promises.readFile(path.join(this.dir, key));
  }
}
