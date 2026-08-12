import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonc } from './jsonc.mjs';

async function collectJsoncFiles(directory) {
  const result = [];
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }

  for (const entry of entries) {
    const itemPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectJsoncFiles(itemPath));
    else if (entry.isFile() && /\.jsonc?$/i.test(entry.name)) result.push(itemPath);
  }
  return result.sort();
}

async function loadCollections(directory, propertyName) {
  const files = await collectJsoncFiles(directory);
  const values = [];
  for (const filePath of files) {
    const parsed = await readJsonc(filePath);
    const collection = Array.isArray(parsed) ? parsed : parsed[propertyName];
    if (!Array.isArray(collection)) {
      throw new Error(`${filePath} must contain an array or a '${propertyName}' array.`);
    }
    for (const value of collection) values.push({ ...value, __source: filePath });
  }
  return values;
}

export async function loadSource(sourceRoot) {
  const site = await readJsonc(path.join(sourceRoot, 'site.jsonc'));
  const platforms = await readJsonc(path.join(sourceRoot, 'platforms.jsonc'));
  const posts = await loadCollections(path.join(sourceRoot, 'posts'), 'posts');
  const artworks = await loadCollections(path.join(sourceRoot, 'artworks'), 'artworks');
  const locales = {};

  for (const filePath of await collectJsoncFiles(path.join(sourceRoot, 'locales'))) {
    const language = path.basename(filePath).replace(/\.jsonc?$/i, '');
    locales[language] = await readJsonc(filePath);
  }

  return { site, platforms, posts, artworks, locales, sourceRoot };
}
