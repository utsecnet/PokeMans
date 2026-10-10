/**
 * Copies the vendored images up to R2.
 *
 * The app's image paths are already written as if the bucket existed -- localImages.ts builds
 * every address from VITE_IMAGE_BASE_URL and a fixed folder name. So this is a straight copy
 * of four directories under client/public with nothing renamed. Renaming anything here means
 * re-uploading all of it, and means the client stops finding any of it.
 *
 * Incremental by size. The bucket is listed once up front -- 24 list calls for ~23,000
 * objects -- and anything already there at the same size is skipped. That makes a re-run
 * after a partial upload cheap, and makes the weekly top-up of new sets almost free.
 *
 *   node supabase/scripts/pushImages.mjs --dry-run     what would go up
 *   node supabase/scripts/pushImages.mjs               send it
 *   node supabase/scripts/pushImages.mjs --only=cards-hi
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? null;

const ROOT = path.resolve(import.meta.dirname, '../..');
const PUBLIC = path.join(ROOT, 'client/public');

/**
 * Only these four. client/public also holds favicon.svg, icons.svg and foil-lab.html, which
 * are served by the app itself and have no business in an image bucket.
 */
const FOLDERS = ['cards', 'cards-hi', 'logos', 'sprites', 'artwork'];

const TYPES = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

/**
 * A year, immutable.
 *
 * Safe because a filename is derived from a card id, and a given card id's artwork does not
 * change. When one does, the fix is to delete that object -- not to weaken the header for
 * the other 23,000.
 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

const UPLOAD_CONCURRENCY = 24;

function env() {
  const file = path.join(ROOT, 'supabase/.env');
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

function fail(message) {
  console.error(`   ${message}`);
  process.exitCode = 1;
}

const e = { ...env(), ...process.env };
const ACCOUNT = e.R2_ACCOUNT_ID;
const KEY = e.R2_ACCESS_KEY_ID;
const SECRET = e.R2_SECRET_ACCESS_KEY;
const BUCKET = e.R2_BUCKET ?? 'pokemans-images';

if (!ACCOUNT || !KEY || !SECRET) {
  fail('missing R2 credentials. supabase/.env needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY');
  process.exit();
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: KEY, secretAccessKey: SECRET },
});

/** Every local file, keyed by the object name it will have in the bucket. */
function localFiles() {
  const out = new Map();
  for (const folder of FOLDERS) {
    if (ONLY && folder !== ONLY) continue;
    const dir = path.join(PUBLIC, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      const type = TYPES[path.extname(name).toLowerCase()];
      if (!type) continue;                      // nothing but images goes up
      out.set(`${folder}/${name}`, { full, size: stat.size, type });
    }
  }
  return out;
}

/** Everything already in the bucket, keyed the same way. One list call per 1,000 objects. */
async function remoteObjects() {
  const out = new Map();
  let token;
  let calls = 0;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of res.Contents ?? []) out.set(o.Key, o.Size);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
    calls++;
    if (calls % 5 === 0) process.stdout.write(`\r   listing the bucket… ${out.size.toLocaleString()}`);
  } while (token);
  if (calls >= 5) process.stdout.write('\r' + ' '.repeat(50) + '\r');
  return out;
}

/** Runs `worker` over `items`, `limit` at a time. */
async function pool(items, limit, worker) {
  let next = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]);
      done++;
      if (done % 100 === 0 || done === items.length) {
        process.stdout.write(`\r   uploaded ${done.toLocaleString()} of ${items.length.toLocaleString()}`);
      }
    }
  });
  await Promise.all(runners);
  if (items.length) process.stdout.write('\n');
}

async function main() {
  const started = Date.now();
  const local = localFiles();
  if (!local.size) {
    fail(ONLY ? `no images found in client/public/${ONLY}` : 'no images found under client/public');
    return;
  }

  const bytes = [...local.values()].reduce((n, f) => n + f.size, 0);
  console.log(`   ${local.size.toLocaleString()} local files, ${(bytes / 1024 / 1024).toFixed(0)} MB`);

  let remote;
  try {
    remote = await remoteObjects();
  } catch (err) {
    fail(`could not read the bucket "${BUCKET}": ${err.message}`);
    return;
  }
  console.log(`   ${remote.size.toLocaleString()} already in the bucket`);

  // Size is enough to tell a finished upload from a missing one. A file whose bytes changed
  // but whose size did not is not a case this pipeline produces -- the encoder is
  // deterministic and the filename is derived from the card id.
  const todo = [];
  for (const [key, file] of local) {
    if (remote.get(key) !== file.size) todo.push([key, file]);
  }

  const byFolder = {};
  for (const [key] of todo) {
    const f = key.slice(0, key.indexOf('/'));
    byFolder[f] = (byFolder[f] ?? 0) + 1;
  }

  console.log('');
  if (!todo.length) {
    console.log('   nothing to upload, the bucket matches what is on disk');
    return;
  }

  const todoBytes = todo.reduce((n, [, f]) => n + f.size, 0);
  console.log(`   ${todo.length.toLocaleString()} to upload, ${(todoBytes / 1024 / 1024).toFixed(0)} MB`);
  for (const [folder, n] of Object.entries(byFolder).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${folder.padEnd(10)}${n.toLocaleString()}`);
  }

  if (DRY_RUN) {
    console.log('');
    console.log('   DRY RUN -- nothing sent');
    return;
  }

  console.log('');
  let failed = 0;
  await pool(todo, UPLOAD_CONCURRENCY, async ([key, file]) => {
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: fs.createReadStream(file.full),
          ContentType: file.type,
          ContentLength: file.size,
          CacheControl: CACHE_CONTROL,
        }),
      );
    } catch (err) {
      failed++;
      if (failed <= 5) console.error(`\n   failed: ${key} -- ${err.message}`);
    }
  });

  const secs = Math.round((Date.now() - started) / 1000);
  console.log('');
  console.log(`   done in ${secs}s, ${(todo.length - failed).toLocaleString()} uploaded, ${failed} failed`);
  if (failed) {
    console.log('   re-run to retry only what is missing');
    process.exitCode = 1;
  }
}

await main();
