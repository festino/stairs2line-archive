import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJson } from './jsonc.mjs';
import { compactObject, copyDirectory, ensureDirectory, normalizePath, unique } from './util.mjs';

const KNOWN_TUMBLR_LAYOUTS = new Map([
  [
    'tumblr:61704687471',
    [
      {
        type: 'rows',
        display: [
          { blocks: [0] },
          { blocks: [1, 2] },
          { blocks: [3, 4] },
          { blocks: [5, 6] }
        ]
      }
    ]
  ]
]);

function cleanEntity(value) {
  if (Array.isArray(value)) return value.map(cleanEntity);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('__'))
      .map(([key, item]) => [key, cleanEntity(item)])
  );
}

function buildMediaIndex(source) {
  const result = new Map();
  for (const artwork of source.artworks ?? []) {
    for (const version of artwork.versions ?? []) {
      for (const media of version.media ?? []) {
        result.set(String(media.id), {
          id: String(media.id),
          files: unique((media.files ?? []).map(normalizePath)).sort()
        });
      }
    }
  }
  return result;
}

function fileScore(post, filePath) {
  const normalized = normalizePath(filePath);
  const [directory = ''] = normalized.split('/');
  const filename = path.posix.basename(normalized);
  const id = String(post.id);
  let score = 0;

  if (filename === id || filename.startsWith(`${id}.`)) score += 220;
  if (filename.startsWith(`${id}_`) || filename.startsWith(`${id}-`)) score += 200;
  if (filename.includes(id)) score += 140;
  if (directory === post.platform) score += 80;
  if (directory === 'other' && !['twitter', 'tumblr', 'pixiv'].includes(post.platform)) score += 40;

  return score;
}

function chooseFileForPost(post, media, report) {
  if (!media || media.files.length === 0) return null;
  if (media.files.length === 1) return media.files[0];

  const ranked = media.files
    .map((filePath) => ({ filePath, score: fileScore(post, filePath) }))
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));

  const topScore = ranked[0]?.score ?? 0;
  const tied = ranked.filter((item) => item.score === topScore);
  if (tied.length > 1 || topScore === 0) {
    report.ambiguousMediaReferences.push({
      post: post.key ?? `${post.platform}:${post.id}`,
      mediaId: media.id,
      selected: ranked[0].filePath,
      candidates: ranked.map((item) => item.filePath),
      score: topScore
    });
  }
  return ranked[0].filePath;
}

function migrateMediaReferences(post, values, mediaById, report) {
  const output = [];
  for (const value of values ?? []) {
    const media = mediaById.get(String(value));
    if (!media) {
      output.push(normalizePath(value));
      if (String(value).includes('/v') && String(value).includes('/m')) {
        report.unresolvedMediaReferences.push({
          post: post.key ?? `${post.platform}:${post.id}`,
          mediaId: String(value)
        });
      }
      continue;
    }

    const filePath = chooseFileForPost(post, media, report);
    if (filePath) {
      output.push(filePath);
      report.convertedMediaReferenceCount += 1;
    } else {
      output.push(String(value));
      report.unresolvedMediaReferences.push({
        post: post.key ?? `${post.platform}:${post.id}`,
        mediaId: String(value)
      });
    }
  }
  return unique(output);
}

function legacyVersionFromPost(post) {
  const {
    key,
    platform,
    id,
    publishedAt,
    __source,
    ...mutable
  } = post;
  return mutable;
}

function publicVersion(post, version, mediaById, report) {
  const migrated = {
    ...version,
    media: migrateMediaReferences(post, version.media ?? [], mediaById, report)
  };
  delete migrated.key;
  delete migrated.platform;
  delete migrated.id;
  delete migrated.publishedAt;
  delete migrated.legacyAutoLink;
  delete migrated.__source;
  return compactObject(migrated);
}

export function upgradeSourcePosts(source) {
  const mediaById = buildMediaIndex(source);
  const report = {
    schemaVersion: 2,
    postCount: 0,
    postVersionCount: 0,
    convertedMediaReferenceCount: 0,
    unresolvedMediaReferences: [],
    ambiguousMediaReferences: [],
    injectedLayouts: []
  };

  const posts = (source.posts ?? []).map((post) => {
    const key = post.key ?? `${post.platform}:${post.id}`;
    const sourceVersions = Array.isArray(post.versions) && post.versions.length > 0
      ? post.versions
      : [legacyVersionFromPost(post)];
    const versions = sourceVersions.map((version) => publicVersion(post, version, mediaById, report));

    if (post.platform === 'tumblr' && KNOWN_TUMBLR_LAYOUTS.has(key) && versions.length > 0 && !versions.at(-1).layout) {
      versions.at(-1).layout = structuredClone(KNOWN_TUMBLR_LAYOUTS.get(key));
      report.injectedLayouts.push(key);
    }

    report.postCount += 1;
    report.postVersionCount += versions.length;
    return {
      key,
      platform: post.platform,
      id: String(post.id),
      ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
      versions,
      __source: post.__source
    };
  });

  return { ...source, posts, report };
}

export async function writeUpgradedSource(sourceRoot, outputRoot, upgradedSource) {
  const sourcePath = path.resolve(sourceRoot);
  const outputPath = path.resolve(outputRoot);
  if (sourcePath === outputPath) throw new Error('upgrade output must be different from source.');

  await fs.rm(outputPath, { recursive: true, force: true });
  await copyDirectory(sourcePath, outputPath);

  const site = cleanEntity({ ...upgradedSource.site, schemaVersion: 2 });
  await writeJson(
    path.join(outputPath, 'site.jsonc'),
    site,
    'Human-editable archive configuration. Code comments must remain in English.'
  );

  const groups = new Map();
  for (const post of upgradedSource.posts) {
    const sourceFile = post.__source;
    if (!sourceFile) continue;
    const relative = path.relative(sourcePath, sourceFile);
    if (!groups.has(relative)) groups.set(relative, []);
    groups.get(relative).push(cleanEntity(post));
  }

  for (const [relative, posts] of groups.entries()) {
    const destination = path.join(outputPath, relative);
    await ensureDirectory(path.dirname(destination));
    await writeJson(
      destination,
      { posts },
      'Versioned posts. Media entries are physical file-path lookup keys for logical artwork media.'
    );
  }

  await writeJson(
    path.join(outputPath, 'migration-v2-report.json'),
    upgradedSource.report,
    'Migration diagnostics for post versions and filename-based post media references.'
  );
}
