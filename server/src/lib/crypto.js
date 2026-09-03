import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data');
const keyPath = path.join(dataDir, 'secret.key');

function loadOrCreateKey() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(keyPath)) {
    return Buffer.from(fs.readFileSync(keyPath, 'utf-8').trim(), 'base64');
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 });
  return key;
}

// Generated once per machine into server/data/secret.key (gitignored, never leaves this
// machine). Losing this file means saved secrets (e.g. the TCG API key) can no longer be
// decrypted and must be re-entered in Settings.
const secretKey = loadOrCreateKey();

export function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decrypt(payload) {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey, iv);
  decipher.setAuthTag(authTag);
  const plainText = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plainText.toString('utf-8');
}
