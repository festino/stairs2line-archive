import path from 'node:path';
import { buildFileCatalog } from './file-catalog.mjs';
import { earliestDate } from './dates.mjs';
import { localizedValue } from './localization.mjs';
import { normalizePath, stableHash, unique } from './util.mjs';

class IssueCollector {
  constructor() {
    this.items = new Map();
  }

  add(issue) {
    const key = `${issue.severity}|${issue.code}|${issue.entityType}|${issue.entityId}`;
    const existing = this.items.get(key);
    if (!existing) {
      const normalized = structuredClone(issue);
      if (normalized.missing) {
        for (const [field, languages] of Object.entries(normalized.missing)) {
          normalized.missing[field] = unique(languages).sort();
        }
      }
      this.items.set(key, normalized);
      return;
    }

    if (issue.missing) {
      existing.missing ??= {};
      for (const [field, languages] of Object.entries(issue.missing)) {
        existing.missing[field] = unique([...(existing.missing[field] ?? []), ...languages]).sort();
      }
    }
    if (issue.details) {
      existing.details ??= [];
      const values = Array.isArray(issue.details) ? issue.details : [issue.details];
      existing.details = unique([...existing.details, ...values]);
    }
  }

  toArray() {
    return [...this.items.values()].sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return `${a.entityType}:${a.entityId}:${a.code}`.localeCompare(`${b.entityType}:${b.entityId}:${b.code}`);
    });
  }
}

function sourceName(entity) {
  return entity.__source ? path.basename(entity.__source) : null;
}

function stripInternal(value) {
  if (Array.isArray(value)) return value.map(stripInternal);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('__'))
      .map(([key, item]) => [key, stripInternal(item)])
  );
}

function validateLocalizedField(issues, entityType, entityId, source, fieldName, value, languages, required) {
  const isMap = value && typeof value === 'object' && !Array.isArray(value);
  if (!isMap) {
    if (required) {
      issues.add({
        severity: 'warning',
        code: 'i18n.missing',
        entityType,
        entityId,
        source,
        missing: { [fieldName]: languages }
      });
    }
    return;
  }

  if (typeof value.default === 'string' && value.default.length > 0) return;
  const missing = languages.filter((language) => typeof value[language] !== 'string' || value[language].length === 0);
  if (missing.length > 0) {
    issues.add({
      severity: 'warning',
      code: 'i18n.missing',
      entityType,
      entityId,
      source,
      missing: { [fieldName]: missing }
    });
  }
}

function buildPostUrl(post, platform) {
  if (post.href) return post.href;
  if (!platform?.postUrlTemplate) return null;
  return platform.postUrlTemplate
    .replaceAll('{id}', encodeURIComponent(post.id))
    .replaceAll('{account}', encodeURIComponent(post.account ?? platform.defaultAccount ?? ''));
}

function selectSmallestFile(files) {
  return [...files].sort((a, b) => a.byteLength - b.byteLength || a.path.localeCompare(b.path))[0] ?? null;
}

function placeholderFile(mediaId) {
  return {
    path: `assets/placeholders/${stableHash(mediaId)}.svg`,
    platform: 'placeholder',
    mimeType: 'image/svg+xml',
    byteLength: 0,
    width: 960,
    height: 960,
    sha256: null,
    legacyMediaId: null,
    postKey: null,
    placeholder: true
  };
}

export async function compileArchive(source, options = {}) {
  const issues = new IssueCollector();
  const languages = source.site.languages ?? ['ru', 'en', 'ja'];
  const defaultLanguage = source.site.defaultLanguage ?? languages[0] ?? 'en';
  const platforms = Array.isArray(source.platforms) ? source.platforms : source.platforms.platforms ?? [];
  const platformsById = new Map(platforms.map((platform) => [platform.id, platform]));
  const knownPostIds = source.posts.map((post) => ({
    key: post.key ?? `${post.platform}:${post.id}`,
    platform: post.platform,
    id: String(post.id)
  }));
  const files = options.mediaRoot
    ? await buildFileCatalog(options.mediaRoot, {
      includeDirectories: source.site.mediaDirectories ?? ['twitter', 'tumblr', 'pixiv', 'other'],
      knownPostIds
    })
    : [];
  const filesByPath = new Map(files.map((file) => [normalizePath(file.path), file]));
  const filesByLegacyId = new Map();
  for (const file of files) {
    if (!filesByLegacyId.has(file.legacyMediaId)) filesByLegacyId.set(file.legacyMediaId, []);
    filesByLegacyId.get(file.legacyMediaId).push(file);
  }

  const compiledFiles = new Map(files.map((file) => [file.path, file]));
  const mediaById = new Map();
  const mediaIdsByFile = new Map();
  const artworks = [];
  const artworkIds = new Set();

  for (const sourceArtwork of source.artworks) {
    const artworkId = String(sourceArtwork.id);
    if (artworkIds.has(artworkId)) {
      issues.add({
        severity: 'error',
        code: 'artwork.duplicate-id',
        entityType: 'artwork',
        entityId: artworkId,
        source: sourceName(sourceArtwork)
      });
      continue;
    }
    artworkIds.add(artworkId);

    validateLocalizedField(issues, 'artwork', artworkId, sourceName(sourceArtwork), 'title', sourceArtwork.title, languages, true);
    validateLocalizedField(issues, 'artwork', artworkId, sourceName(sourceArtwork), 'description', sourceArtwork.description, languages, true);

    const versionIds = new Set();
    const versions = [];
    for (const sourceVersion of sourceArtwork.versions ?? []) {
      const versionId = String(sourceVersion.id);
      const versionKey = `${artworkId}/${versionId}`;
      if (versionIds.has(versionId)) {
        issues.add({
          severity: 'error',
          code: 'version.duplicate-id',
          entityType: 'artworkVersion',
          entityId: versionKey,
          source: sourceName(sourceArtwork)
        });
        continue;
      }
      versionIds.add(versionId);

      const mediaIds = [];
      for (const sourceMedia of sourceVersion.media ?? []) {
        const mediaId = String(sourceMedia.id);
        if (mediaById.has(mediaId)) {
          issues.add({
            severity: 'error',
            code: 'media.duplicate-id',
            entityType: 'media',
            entityId: mediaId,
            source: sourceName(sourceArtwork)
          });
          continue;
        }

        const declaredFiles = unique((sourceMedia.files ?? []).map(normalizePath));
        const legacyIds = unique((sourceMedia.legacyIds ?? []).map(String));
        const existingFiles = [];
        const missingFiles = [];
        const unresolvedLegacyIds = [];

        for (const declaredPath of declaredFiles) {
          const file = filesByPath.get(declaredPath);
          if (file) existingFiles.push(file);
          else missingFiles.push(declaredPath);
        }
        for (const legacyId of legacyIds) {
          const matches = filesByLegacyId.get(legacyId) ?? [];
          if (matches.length === 0) unresolvedLegacyIds.push(legacyId);
          else existingFiles.push(...matches);
        }

        const deduplicatedFiles = [...new Map(existingFiles.map((file) => [file.path, file])).values()];
        let displayFile = selectSmallestFile(deduplicatedFiles);
        if (!displayFile && options.previewPlaceholders) {
          displayFile = placeholderFile(mediaId);
          deduplicatedFiles.push(displayFile);
          compiledFiles.set(displayFile.path, displayFile);
        }

        if (!displayFile) {
          issues.add({
            severity: 'error',
            code: 'media.no-existing-file',
            entityType: 'media',
            entityId: mediaId,
            source: sourceName(sourceArtwork),
            details: [...missingFiles, ...unresolvedLegacyIds]
          });
        } else if (missingFiles.length > 0 || unresolvedLegacyIds.length > 0) {
          issues.add({
            severity: 'warning',
            code: 'media.some-files-missing',
            entityType: 'media',
            entityId: mediaId,
            source: sourceName(sourceArtwork),
            details: [...missingFiles, ...unresolvedLegacyIds]
          });
        }

        const compiledMedia = {
          id: mediaId,
          artworkId,
          versionId,
          declaredFiles,
          legacyIds,
          existingFiles: deduplicatedFiles.map((file) => file.path),
          missingFiles,
          unresolvedLegacyIds,
          displayFile: displayFile?.path ?? null,
          postIds: []
        };
        mediaById.set(mediaId, compiledMedia);
        mediaIds.push(mediaId);

        for (const file of deduplicatedFiles) {
          if (!mediaIdsByFile.has(file.path)) mediaIdsByFile.set(file.path, []);
          mediaIdsByFile.get(file.path).push(mediaId);
        }
      }

      if (mediaIds.length === 0) {
        issues.add({
          severity: 'error',
          code: 'version.no-media',
          entityType: 'artworkVersion',
          entityId: versionKey,
          source: sourceName(sourceArtwork)
        });
      }

      versions.push({
        id: versionId,
        key: versionKey,
        scope: sourceVersion.scope ?? 'major',
        createdAt: sourceVersion.createdAt ?? null,
        knownNotAfter: sourceVersion.knownNotAfter ?? null,
        mediaIds,
        migration: sourceVersion.migration ?? null,
        sortAt: null,
        dateSource: null
      });
    }

    if (versions.length === 0) {
      issues.add({
        severity: 'error',
        code: 'artwork.no-versions',
        entityType: 'artwork',
        entityId: artworkId,
        source: sourceName(sourceArtwork)
      });
    }

    artworks.push({
      id: artworkId,
      slug: sourceArtwork.slug ?? artworkId,
      title: sourceArtwork.title ?? {},
      description: sourceArtwork.description ?? {},
      versions,
      migration: sourceArtwork.migration ?? null,
      sortAt: null,
      platforms: []
    });
  }

  const posts = [];
  const postIds = new Set();
  const filesByPostKey = new Map();
  for (const file of files) {
    if (!file.postKey) continue;
    if (!filesByPostKey.has(file.postKey)) filesByPostKey.set(file.postKey, []);
    filesByPostKey.get(file.postKey).push(file.path);
  }

  for (const sourcePost of source.posts) {
    const key = sourcePost.key ?? `${sourcePost.platform}:${sourcePost.id}`;
    if (postIds.has(key)) {
      issues.add({
        severity: 'error',
        code: 'post.duplicate-id',
        entityType: 'post',
        entityId: key,
        source: sourceName(sourcePost)
      });
      continue;
    }
    postIds.add(key);

    if (!['alive', 'deleted'].includes(sourcePost.status)) {
      issues.add({
        severity: 'error',
        code: 'post.invalid-status',
        entityType: 'post',
        entityId: key,
        source: sourceName(sourcePost),
        details: String(sourcePost.status)
      });
    }

    if (sourcePost.title) {
      validateLocalizedField(issues, 'post', key, sourceName(sourcePost), 'title', sourcePost.title, languages, false);
    }
    if (sourcePost.description) {
      validateLocalizedField(issues, 'post', key, sourceName(sourcePost), 'description', sourcePost.description, languages, false);
    }

    const effectiveStatus = sourcePost.publishedAt ? sourcePost.status : 'deleted';
    if (!sourcePost.publishedAt && sourcePost.status === 'alive') {
      issues.add({
        severity: 'warning',
        code: 'post.date-missing-treated-deleted',
        entityType: 'post',
        entityId: key,
        source: sourceName(sourcePost)
      });
    }

    const resolvedMediaIds = new Set(sourcePost.media ?? []);
    if (sourcePost.legacyAutoLink) {
      for (const filePath of filesByPostKey.get(key) ?? []) {
        for (const mediaId of mediaIdsByFile.get(filePath) ?? []) resolvedMediaIds.add(mediaId);
      }
    }

    for (const mediaId of [...resolvedMediaIds]) {
      const media = mediaById.get(mediaId);
      if (!media) {
        issues.add({
          severity: 'error',
          code: 'post.unknown-media',
          entityType: 'post',
          entityId: key,
          source: sourceName(sourcePost),
          details: mediaId
        });
        resolvedMediaIds.delete(mediaId);
        continue;
      }
      media.postIds.push(key);
    }

    if (resolvedMediaIds.size === 0) {
      issues.add({
        severity: options.previewPlaceholders ? 'warning' : 'error',
        code: 'post.no-media',
        entityType: 'post',
        entityId: key,
        source: sourceName(sourcePost)
      });
    }

    const platform = platformsById.get(sourcePost.platform);
    posts.push({
      key,
      platform: sourcePost.platform,
      id: String(sourcePost.id),
      account: sourcePost.account ?? platform?.defaultAccount ?? null,
      status: effectiveStatus,
      declaredStatus: sourcePost.status,
      publishedAt: sourcePost.publishedAt ?? null,
      originalLanguage: sourcePost.originalLanguage ?? defaultLanguage,
      title: sourcePost.title ?? {},
      description: sourcePost.description ?? {},
      mediaIds: [...resolvedMediaIds],
      href: buildPostUrl(sourcePost, platform),
      source: sourceName(sourcePost)
    });
  }

  const postsById = new Map(posts.map((post) => [post.key, post]));
  for (const media of mediaById.values()) media.postIds = unique(media.postIds);

  for (const artwork of artworks) {
    const artworkPlatforms = new Set();
    for (const version of artwork.versions) {
      const linkedPosts = version.mediaIds
        .flatMap((mediaId) => mediaById.get(mediaId)?.postIds ?? [])
        .map((postId) => postsById.get(postId))
        .filter(Boolean);
      for (const post of linkedPosts) artworkPlatforms.add(post.platform);
      const postDate = earliestDate(linkedPosts.map((post) => post.publishedAt));
      version.sortAt = version.createdAt ?? version.knownNotAfter ?? postDate;
      version.dateSource = version.createdAt
        ? 'createdAt'
        : version.knownNotAfter
          ? 'knownNotAfter'
          : postDate
            ? 'post'
            : null;
      if (!version.sortAt) {
        issues.add({
          severity: 'warning',
          code: 'version.date-missing',
          entityType: 'artworkVersion',
          entityId: version.key
        });
      }
    }
    artwork.sortAt = earliestDate(artwork.versions.map((version) => version.sortAt));
    artwork.platforms = [...artworkPlatforms].sort();
  }

  const referencedFiles = new Set(mediaIdsByFile.keys());
  const filesWithPosts = new Set();
  for (const media of mediaById.values()) {
    if (media.postIds.length === 0) continue;
    for (const filePath of media.existingFiles) filesWithPosts.add(filePath);
  }
  for (const file of files) {
    if (!referencedFiles.has(file.path)) {
      issues.add({
        severity: 'warning',
        code: 'file.unassigned-to-artwork',
        entityType: 'file',
        entityId: file.path
      });
    }
    if (!filesWithPosts.has(file.path)) {
      issues.add({
        severity: 'warning',
        code: 'file.unassigned-to-post',
        entityType: 'file',
        entityId: file.path
      });
    }
  }

  const media = [...mediaById.values()];
  const resultIssues = issues.toArray();
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    site: stripInternal(source.site),
    platforms: stripInternal(platforms),
    languages,
    defaultLanguage,
    files: Object.fromEntries([...compiledFiles.values()].map((file) => [file.path, file])),
    media: Object.fromEntries(media.map((item) => [item.id, item])),
    artworks,
    posts,
    summary: {
      artworkCount: artworks.length,
      versionCount: artworks.reduce((sum, artwork) => sum + artwork.versions.length, 0),
      mediaCount: media.length,
      postCount: posts.length,
      fileCount: files.length,
      errorCount: resultIssues.filter((issue) => issue.severity === 'error').length,
      warningCount: resultIssues.filter((issue) => issue.severity === 'warning').length
    }
  };

  return { manifest, issues: resultIssues, fileCatalog: files };
}

export function resolveSourceFiles(source, fileCatalog) {
  const filesByLegacyId = new Map();
  for (const file of fileCatalog) {
    if (!filesByLegacyId.has(file.legacyMediaId)) filesByLegacyId.set(file.legacyMediaId, []);
    filesByLegacyId.get(file.legacyMediaId).push(file);
  }

  const mediaByFile = new Map();
  const mediaById = new Map();
  for (const artwork of source.artworks) {
    for (const version of artwork.versions ?? []) {
      for (const media of version.media ?? []) {
        const paths = new Set((media.files ?? []).map(normalizePath));
        for (const legacyId of media.legacyIds ?? []) {
          for (const file of filesByLegacyId.get(String(legacyId)) ?? []) paths.add(file.path);
        }
        media.files = [...paths].sort((a, b) => {
          const fileA = fileCatalog.find((file) => file.path === a);
          const fileB = fileCatalog.find((file) => file.path === b);
          return (fileA?.byteLength ?? Number.MAX_SAFE_INTEGER) - (fileB?.byteLength ?? Number.MAX_SAFE_INTEGER)
            || a.localeCompare(b);
        });
        mediaById.set(media.id, media);
        for (const filePath of media.files) {
          if (!mediaByFile.has(filePath)) mediaByFile.set(filePath, []);
          mediaByFile.get(filePath).push(media.id);
        }
      }
    }
  }

  const filesByPost = new Map();
  for (const file of fileCatalog) {
    if (!file.postKey) continue;
    if (!filesByPost.has(file.postKey)) filesByPost.set(file.postKey, []);
    filesByPost.get(file.postKey).push(file.path);
  }

  for (const post of source.posts) {
    const key = post.key ?? `${post.platform}:${post.id}`;
    const mediaIds = new Set(post.media ?? []);
    if (post.legacyAutoLink) {
      for (const filePath of filesByPost.get(key) ?? []) {
        for (const mediaId of mediaByFile.get(filePath) ?? []) mediaIds.add(mediaId);
      }
    }
    post.media = [...mediaIds].filter((mediaId) => mediaById.has(mediaId));
  }

  return source;
}

export function getLocalizedEntityLabel(entity, language, fallbackLanguage) {
  return localizedValue(entity.title, language, fallbackLanguage) ?? entity.id ?? entity.key;
}
