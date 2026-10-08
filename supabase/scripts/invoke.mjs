/**
 * Invokes an Edge Function with the service key, for testing from this machine.
 *
 *   node supabase/scripts/invoke.mjs <function> '{"json":"body"}'
 *
 * Exits nonzero when the call fails, so a caller can tell. It used to print the status and
 * exit 0 regardless, which meant a 500 from the function read as success to anything
 * chaining off it -- including me, running it by hand and reading the number rather than
 * the exit code.
 *
 * A function can also answer 200 with {"ok": false} or an error field, so the body is
 * checked too: HTTP status alone is not the whole answer.
 */
import fs from 'node:fs';

const readEnv = (file) => {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
};

const env = { ...readEnv('client/.env.local'), ...readEnv('supabase/.env') };

const name = process.argv[2];
if (!name) {
  console.error('   usage: node supabase/scripts/invoke.mjs <function> [json-body]');
  process.exit(2);
}
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('   Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const body = process.argv[3] ?? '{}';
try {
  JSON.parse(body);
} catch (err) {
  console.error(`   the body is not valid JSON: ${err.message}`);
  process.exit(2);
}

const startedAt = Date.now();
let res;
let text;
try {
  res = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  text = await res.text();
} catch (err) {
  console.error(`   could not reach ${name}: ${err.message}`);
  process.exit(1);
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`   HTTP ${res.status}  ${seconds}s`);

let parsed = null;
try {
  parsed = JSON.parse(text);
  console.log('   ' + JSON.stringify(parsed, null, 2).split('\n').join('\n   '));
} catch {
  console.log('   ' + text.slice(0, 500));
}

// A function that answers 200 while reporting its own failure has still failed.
const reportedFailure = parsed !== null
  && typeof parsed === 'object'
  && (parsed.ok === false || typeof parsed.error === 'string');

// exitCode rather than exit(). Calling process.exit() here tears the process down while the
// HTTP socket is still closing, and on Windows that trips a libuv assertion -- the process
// dies with 127 and the code set here never lands. Setting the code and letting Node leave
// on its own once handles drain reports what actually happened.
process.exitCode = res.ok && !reportedFailure ? 0 : 1;
