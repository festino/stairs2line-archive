import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePath, toPosixRelative } from './util.mjs';

const MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.avif', 'image/avif'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime']
]);

async function walk(directory) {
  const result = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const itemPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(itemPath));
    else if (entry.isFile()) result.push(itemPath);
  }
  return result;
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readGifDimensions(buffer) {
  if (buffer.length < 10 || !['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  if (chunk === 'VP8L' && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }
  return null;
}

function readSvgDimensions(buffer) {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 16384));
  if (!/<svg\b/i.test(text)) return null;
  const width = text.match(/\bwidth=["']([0-9.]+)(?:px)?["']/i)?.[1];
  const height = text.match(/\bheight=["']([0-9.]+)(?:px)?["']/i)?.[1];
  if (width && height) return { width: Number(width), height: Number(height) };
  const viewBox = text.match(/\bviewBox=["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)\s*["']/i);
  return viewBox ? { width: Number(viewBox[1]), height: Number(viewBox[2]) } : null;
}

function readDimensions(buffer, extension) {
  if (extension === '.png') return readPngDimensions(buffer);
  if (extension === '.gif') return readGifDimensions(buffer);
  if (extension === '.jpg' || extension === '.jpeg') return readJpegDimensions(buffer);
  if (extension === '.webp') return readWebpDimensions(buffer);
  if (extension === '.svg') return readSvgDimensions(buffer);
  return null;
}

export function extractLegacyMediaId(relativePath) {
  const normalized = normalizePath(relativePath);
  const slashIndex = normalized.indexOf('/');
  const platform = slashIndex >= 0 ? normalized.slice(0, slashIndex) : '';
  let filename = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  filename = path.posix.basename(filename);

  if (/^\d{4}-\d{2}-\d{2}_/.test(filename)) filename = filename.slice(11);
  let mediaId = filename.slice(0, filename.length - path.posix.extname(filename).length);

  const startsWithNumber = /^\d/.test(mediaId);
  if ((platform === 'twitter' && startsWithNumber) || platform === 'tumblr') {
    const firstUnderscore = mediaId.indexOf('_');
    if (firstUnderscore >= 0) mediaId = mediaId.slice(firstUnderscore + 1);
    if (platform === 'tumblr') {
      const secondUnderscore = mediaId.indexOf('_');
      if (secondUnderscore >= 0) mediaId = mediaId.slice(secondUnderscore + 1);
    }
  }

  return mediaId;
}

export function extractPostIdFromFile(relativePath, knownPostIds = []) {
  const normalized = normalizePath(relativePath);
  const slashIndex = normalized.indexOf('/');
  const platform = slashIndex >= 0 ? normalized.slice(0, slashIndex) : '';
  let filename = path.posix.basename(normalized);
  if (/^\d{4}-\d{2}-\d{2}_/.test(filename)) filename = filename.slice(11);

  const candidates = knownPostIds
    .filter((item) => {
      const platformMatches = platform === 'other'
        ? !['twitter', 'tumblr', 'pixiv'].includes(item.platform)
        : item.platform === platform;
      return platformMatches && filename.startsWith(item.id);
    })
    .sort((a, b) => b.id.length - a.id.length);
  return candidates[0]?.key ?? null;
}

export async function buildFileCatalog(mediaRoot, options = {}) {
  const includeDirectories = options.includeDirectories ?? ['twitter', 'tumblr', 'pixiv', 'other'];
  const knownPostIds = options.knownPostIds ?? [];
  const files = [];

  for (const directoryName of includeDirectories) {
    const directoryPath = path.join(mediaRoot, directoryName);
    try {
      const stat = await fs.stat(directoryPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    for (const filePath of await walk(directoryPath)) {
      const relativePath = toPosixRelative(mediaRoot, filePath);
      const extension = path.extname(filePath).toLowerCase();
      if (!MIME_TYPES.has(extension)) continue;
      const buffer = await fs.readFile(filePath);
      const stat = await fs.stat(filePath);
      const dimensions = readDimensions(buffer, extension);
      files.push({
        path: relativePath,
        platform: relativePath.split('/')[0],
        mimeType: MIME_TYPES.get(extension),
        byteLength: stat.size,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        legacyMediaId: extractLegacyMediaId(relativePath),
        postKey: extractPostIdFromFile(relativePath, knownPostIds)
      });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}
