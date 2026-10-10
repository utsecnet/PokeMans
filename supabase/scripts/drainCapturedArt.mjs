/**
 * Converts the card art the Worker captured, and clears the staging area.
 *
 * The Worker fetches a card's full-size art the first time anyone opens it and parks the
 * upstream png in cards-hi-raw/. It cannot convert: cardart.mjs uses sharp, a native binary
 * a Worker isolate cannot load, and a wasm avif encoder wants seconds of CPU against a 10ms
 * budget. So conversion happens here, on a machine that has sharp, whenever it suits.
 *
 * Until this runs, those cards serve at roughly 754KB instead of 56KB -- correct, just
 * thirteen times larger than it needs to be, and counting against a 10GB bucket. Run it
 * after a browsing session, or on a schedule once there is a pipeline.
 *
 *   node supabase/scripts/drainCapturedArt.mjs --dry-run
 *   node supabase/scripts/drainCapturedArt.mjs
 *   node supabase/scripts/drainCapturedArt.mjs --keep-raw    convert but do not delete
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const DRY_RUN = process.argv.includes('--dry-run');
const KEEP_RAW = process.argv.includes('--keep-raw');

const ROOT = path.resolve(import.meta.dirname, '../..');

const RAW_PREFIX = 'cards-hi-raw/';
const OUT_PREFIX = 'cards-hi/';

// The same numbers cardart.mjs uses. They have to match, or a card captured on demand looks
// different from one vendored in a batch, and nobody would ever work out why.
const FULL_MAX_WIDTH = 700;
const FULL_QUALITY = 60;
const EFFORT = 6;

// Encoding is the slow half and it is CPU-bound; the downloads overlap underneath.
const CONCURRENCY = 4;

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

const e = { ...env(), ...process.env };
const BUCKET = e.R2_BUCKET ?? 'pokemans-images';

if (!e.R2_ACCOUNT_ID || !e.R2_ACCESS_KEY_ID || !e.R2_SECRET_ACCESS_KEY) {
  console.error('   missing R2 credentials in supabase/.env');
  process.exitCode = 1;
  process.exit();
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY },
});

async function listRaw() {
  const out = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: RAW_PREFIX, ContinuationToken: token }),
    );
    for (const o of res.Contents ?? []) out.push({ key: o.Key, size: o.Size });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function body(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const c of res.Body) chunks.push(c);
  return Buffer.concat(chunks);
}

async function pool(items, limit, worker) {
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await worker(items[i]);
        done++;
        process.stdout.write(`\r   converted ${done} of ${items.length}`);
      }
    }),
  );
  if (items.length) process.stdout.write('\n');
}

async function main() {
  const started = Date.now();
  const raw = await listRaw();

  if (!raw.length) {
    console.log('   nothing captured, nothing to do');
    return;
  }

  const rawBytes = raw.reduce((n, o) => n + o.size, 0);
  console.log(`   ${raw.length} captured, ${(rawBytes / 1024 / 1024).toFixed(1)} MB`);

  if (DRY_RUN) {
    for (const o of raw.slice(0, 10)) {
      console.log(`      ${o.key.slice(RAW_PREFIX.length)}  ${Math.round(o.size / 1024)}KB`);
    }
    if (raw.length > 10) console.log(`      … and ${raw.length - 10} more`);
    console.log('');
    console.log('   DRY RUN -- nothing converted');
    return;
  }

  let outBytes = 0;
  let failed = 0;
  const converted = [];

  await pool(raw, CONCURRENCY, async (o) => {
    const cardId = o.key.slice(RAW_PREFIX.length).replace(/\.png$/i, '');
    try {
      const source = await body(o.key);
      const avif = await sharp(source)
        .resize({ width: FULL_MAX_WIDTH, withoutEnlargement: true })
        .avif({ quality: FULL_QUALITY, effort: EFFORT })
        .toBuffer();

      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: `${OUT_PREFIX}${cardId}.avif`,
          Body: avif,
          ContentType: 'image/avif',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );

      // Written to disk as well, so a later pushImages run does not fetch it back down and
      // so the dev server shows the same picture as production.
      fs.writeFileSync(path.join(ROOT, 'client/public/cards-hi', `${cardId}.avif`), avif);

      outBytes += avif.length;
      converted.push(o.key);
    } catch (err) {
      failed++;
      if (failed <= 5) console.error(`\n   failed: ${cardId} -- ${err.message}`);
    }
  });

  // Deleted only after a successful write, and only the keys that succeeded, so a failure
  // leaves its source in place to be retried rather than losing the capture.
  if (converted.length && !KEEP_RAW) {
    for (let i = 0; i < converted.length; i += 1000) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: converted.slice(i, i + 1000).map((Key) => ({ Key })) },
        }),
      );
    }
  }

  const secs = Math.round((Date.now() - started) / 1000);
  console.log('');
  console.log(`   ${converted.length} converted, ${failed} failed, ${secs}s`);
  console.log(
    `   ${(rawBytes / 1024 / 1024).toFixed(1)} MB -> ${(outBytes / 1024 / 1024).toFixed(1)} MB` +
      (rawBytes ? `  (${(outBytes / rawBytes * 100).toFixed(0)}% of the captured size)` : ''),
  );
  if (KEEP_RAW) console.log('   raw kept, as asked');
  else if (converted.length) console.log(`   ${converted.length} staged files removed`);
  if (failed) process.exitCode = 1;
}

await main();
