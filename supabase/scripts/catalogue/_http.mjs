export async function fetchJson(url, { retries = 3, headers = {}, backoffMs = 300 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText} for ${url}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(backoffMs * (attempt + 1));
      }
    }
  }
  throw lastError;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
