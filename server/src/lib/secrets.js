import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// API keys belong to the user's accounts elsewhere, so they're encrypted at rest rather
// than sitting in the database as plain text.
//
// The encryption key deliberately lives OUTSIDE the app directory: this project is kept
// under OneDrive, so personal.sqlite is synced to the cloud. Storing the key beside the
// database would sync both halves together and the encryption would protect nothing. Here
// it goes in the per-machine app-data directory, which isn't synced — so a copy of the
// database on its own (in the cloud, in a backup, in a git repo) can't be read.
//
// This protects the database file, not the machine: anything running as this user can read
// both halves. That's the appropriate bar for a local single-user app, and it's worth being
// clear that it isn't a defence against someone who already has your account.
const KEY_DIR =
  process.env.POKEMANS_SECRET_DIR ??
  path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), 'PokeMans');
const KEY_PATH = path.join(KEY_DIR, 'secrets.key');

const ALGORITHM = 'aes-256-gcm';

let cachedKey = null;

function secretKey() {
  if (cachedKey) return cachedKey;
  if (fs.existsSync(KEY_PATH)) {
    cachedKey = fs.readFileSync(KEY_PATH);
    if (cachedKey.length !== 32) throw new Error(`Corrupt key file at ${KEY_PATH}`);
    return cachedKey;
  }
  fs.mkdirSync(KEY_DIR, { recursive: true });
  cachedKey = crypto.randomBytes(32);
  // 0o600 is honoured on POSIX; on Windows the file inherits the user profile's ACL, which
  // already restricts it to this account.
  fs.writeFileSync(KEY_PATH, cachedKey, { mode: 0o600 });
  console.log(`[secrets] Created a new encryption key at ${KEY_PATH}`);
  return cachedKey;
}

/** Encrypts a secret for storage. Returns a single self-describing string. */
export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // v1 marks the format so this can change later without guessing at old rows.
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** Reverses encryptSecret. Returns null if the value can't be read with the current key. */
export function decryptSecret(stored) {
  try {
    const [version, iv, tag, ciphertext] = String(stored).split(':');
    if (version !== 'v1') return null;
    const decipher = crypto.createDecipheriv(ALGORITHM, secretKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong key (e.g. the database was copied to another machine) or tampered ciphertext.
    return null;
  }
}

/** What's safe to show in the UI: never the key, just enough to recognise which one it is. */
export function maskSecret(plaintext) {
  const s = String(plaintext ?? '');
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

export const secretKeyPath = KEY_PATH;
