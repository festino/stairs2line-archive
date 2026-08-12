const TWITTER_EPOCH_MS = 1288834974657n;

export function normalizeUnixTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const milliseconds = number > 2147483647 ? number : number * 1000;
  return new Date(milliseconds).toISOString();
}

export function twitterPostDate(postId) {
  try {
    const snowflake = BigInt(String(postId));
    const unixMs = (snowflake >> 22n) + TWITTER_EPOCH_MS;
    return new Date(Number(unixMs)).toISOString();
  } catch {
    return null;
  }
}

export function twitterMediaDate(mediaId) {
  if (!mediaId || typeof mediaId !== 'string') return null;
  try {
    let base64 = mediaId.replaceAll('-', '+').replaceAll('_', '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length < 8) return null;
    let snowflake = 0n;
    for (let index = 0; index < 8; index += 1) {
      snowflake = (snowflake << 8n) | BigInt(bytes[index]);
    }
    const unixMs = (snowflake >> 22n) + TWITTER_EPOCH_MS;
    const result = new Date(Number(unixMs));
    return Number.isNaN(result.getTime()) ? null : result.toISOString();
  } catch {
    return null;
  }
}

export function toDateOnly(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function earliestDate(values) {
  const valid = values
    .filter(Boolean)
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((a, b) => a.time - b.time);
  return valid[0]?.value ?? null;
}

export function latestDate(values) {
  const valid = values
    .filter(Boolean)
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((a, b) => b.time - a.time);
  return valid[0]?.value ?? null;
}
