import path from 'node:path';
import { buildFileCatalog } from './file-catalog.mjs';
import { earliestDate } from './dates.mjs';
import { localizedValue } from './localization.mjs';
import { upgradeSourcePosts } from './source-upgrader.mjs';
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

function sourcePostVersions(post) {
  if (Array.isArray(post.versions) && post.versions.length > 0) return post.versions;
  const {
    key,
    platform,
    id,
    publishedAt,
    __source,
    ...legacyVersion
  } = post;
  return [legacyVersion];
}

function postFileScore(post, filePath) {
  const normalized = normalizePath(filePath);
  const slashIndex = normalized.indexOf('/');
  const directory = slashIndex >= 0 ? normalized.slice(0, slashIndex) : '';
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

function selectDeclaredFileForPost(post, media) {
  const candidates = media?.declaredFiles ?? [];
  return [...candidates]
    .sort((a, b) => postFileScore(post, b) - postFileScore(post, a) || a.localeCompare(b))[0]
    ?? null;
}

function validatePostLayout(issues, postKey, source, layout, mediaCount, versionIndex) {
  if (layout == null) return;
  const entityId = `${postKey}#${versionIndex + 1}`;
  if (!Array.isArray(layout)) {
    issues.add({
      severity: 'error',
      code: 'post.layout-invalid',
      entityType: 'postVersion',
      entityId,
      source,
      details: 'layout must be an array'
    });
    return;
  }

  const used = new Set();
  for (const section of layout) {
    if (section?.type !== 'rows' || !Array.isArray(section.display)) {
      issues.add({
        severity: 'error',
        code: 'post.layout-unsupported',
        entityType: 'postVersion',
        entityId,
        source,
        details: section?.type ?? 'missing type'
      });
      continue;
    }
    for (const row of section.display) {
      if (!Array.isArray(row?.blocks) || row.blocks.length === 0) {
        issues.add({
          severity: 'error',
          code: 'post.layout-invalid-row',
          entityType: 'postVersion',
          entityId,
          source
        });
        continue;
      }
      for (const block of row.blocks) {
        if (!Number.isInteger(block) || block < 0 || block >= mediaCount) {
          issues.add({
            severity: 'error',
            code: 'post.layout-out-of-range',
            entityType: 'postVersion',
            entityId,
            source,
            details: String(block)
          });
          continue;
        }
        if (used.has(block)) {
          issues.add({
            severity: 'error',
            code: 'post.layout-duplicate-block',
            entityType: 'postVersion',
            entityId,
            source,
            details: String(block)
          });
        }
        used.add(block);
      }
    }
  }

  if (used.size < mediaCount) {
    const missing = [];
    for (let index = 0; index < mediaCount; index += 1) {
      if (!used.has(index)) missing.push(String(index));
    }
    issues.add({
      severity: 'warning',
      code: 'post.layout-incomplete',
      entityType: 'postVersion',
      entityId,
      source,
      details: missing
    });
  }
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
  const mediaIdsByDeclaredFile = new Map();
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

        for (const filePath of declaredFiles) {
          if (!mediaIdsByDeclaredFile.has(filePath)) mediaIdsByDeclaredFile.set(filePath, []);
          mediaIdsByDeclaredFile.get(filePath).push(mediaId);
        }

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
    const source = sourceName(sourcePost);
    if (postIds.has(key)) {
      issues.add({
        severity: 'error',
        code: 'post.duplicate-id',
        entityType: 'post',
        entityId: key,
        source
      });
      continue;
    }
    postIds.add(key);

    const platform = platformsById.get(sourcePost.platform);
    if (!platform) {
      issues.add({
        severity: 'error',
        code: 'post.unknown-platform',
        entityType: 'post',
        entityId: key,
        source,
        details: String(sourcePost.platform)
      });
    }

    const versions = [];
    const rawVersions = sourcePostVersions(sourcePost);
    if (rawVersions.length === 0) {
      issues.add({
        severity: 'error',
        code: 'post.no-versions',
        entityType: 'post',
        entityId: key,
        source
      });
    }

    for (const [versionIndex, sourceVersion] of rawVersions.entries()) {
      const versionEntityId = `${key}#${versionIndex + 1}`;
      const declaredStatus = sourceVersion.status;
      if (!['alive', 'deleted'].includes(declaredStatus)) {
        issues.add({
          severity: 'error',
          code: 'post.invalid-status',
          entityType: 'postVersion',
          entityId: versionEntityId,
          source,
          details: String(declaredStatus)
        });
      }

      if (sourceVersion.title) {
        validateLocalizedField(issues, 'postVersion', versionEntityId, source, 'title', sourceVersion.title, languages, false);
      }
      if (sourceVersion.description) {
        validateLocalizedField(issues, 'postVersion', versionEntityId, source, 'description', sourceVersion.description, languages, false);
      }

      const effectiveStatus = sourcePost.publishedAt ? declaredStatus : 'deleted';
      if (!sourcePost.publishedAt && declaredStatus === 'alive') {
        issues.add({
          severity: 'warning',
          code: 'post.date-missing-treated-deleted',
          entityType: 'postVersion',
          entityId: versionEntityId,
          source
        });
      }

      const rawMedia = [...(sourceVersion.media ?? [])];
      if (sourceVersion.legacyAutoLink || (!Array.isArray(sourcePost.versions) && sourcePost.legacyAutoLink)) {
        rawMedia.push(...(filesByPostKey.get(key) ?? []));
      }

      const mediaRefs = [];
      const seenRefKeys = new Set();
      for (const rawReference of rawMedia) {
        const reference = String(rawReference);
        let filePath = null;
        let candidateMediaIds = [];

        const legacyMedia = mediaById.get(reference);
        if (legacyMedia) {
          filePath = selectDeclaredFileForPost(sourcePost, legacyMedia);
          candidateMediaIds = [legacyMedia.id];
        } else {
          filePath = normalizePath(reference);
          candidateMediaIds = mediaIdsByDeclaredFile.get(filePath) ?? [];
        }

        if (!filePath) {
          issues.add({
            severity: 'error',
            code: 'post.media-reference-unresolved',
            entityType: 'postVersion',
            entityId: versionEntityId,
            source,
            details: reference
          });
          continue;
        }

        if (candidateMediaIds.length === 0) {
          issues.add({
            severity: 'error',
            code: 'post.file-unassigned-to-artwork',
            entityType: 'postVersion',
            entityId: versionEntityId,
            source,
            details: filePath
          });
        } else if (candidateMediaIds.length > 1) {
          issues.add({
            severity: 'warning',
            code: 'post.file-ambiguous-artwork',
            entityType: 'postVersion',
            entityId: versionEntityId,
            source,
            details: `${filePath}: ${candidateMediaIds.join(', ')}`
          });
        }

        const mediaId = candidateMediaIds[0] ?? null;
        const media = mediaId ? mediaById.get(mediaId) : null;
        const physicalFile = filesByPath.get(filePath) ?? null;
        if (!physicalFile) {
          issues.add({
            severity: options.previewPlaceholders ? 'warning' : 'error',
            code: 'post.file-missing',
            entityType: 'postVersion',
            entityId: versionEntityId,
            source,
            details: filePath
          });
        }

        // The filename in a post is a stable human-friendly lookup key for the
        // logical media item. Rendering should still use the lightest existing
        // equivalent file selected for that media item.
        const displayFile = media?.displayFile ?? physicalFile?.path ?? null;
        const refKey = `${filePath}|${mediaId ?? ''}`;
        if (seenRefKeys.has(refKey)) continue;
        seenRefKeys.add(refKey);
        mediaRefs.push({
          filePath,
          mediaId,
          mediaIds: [...candidateMediaIds],
          displayFile
        });
        for (const candidateMediaId of candidateMediaIds) {
          mediaById.get(candidateMediaId)?.postIds.push(key);
        }
      }

      if (mediaRefs.length === 0) {
        issues.add({
          severity: options.previewPlaceholders ? 'warning' : 'error',
          code: 'post.no-media',
          entityType: 'postVersion',
          entityId: versionEntityId,
          source
        });
      }

      validatePostLayout(issues, key, source, sourceVersion.layout, mediaRefs.length, versionIndex);

      const version = {
        index: versionIndex,
        account: sourceVersion.account ?? platform?.defaultAccount ?? null,
        status: effectiveStatus,
        declaredStatus,
        originalLanguage: sourceVersion.originalLanguage ?? defaultLanguage,
        title: sourceVersion.title ?? {},
        description: sourceVersion.description ?? {},
        mediaFiles: mediaRefs.map((item) => item.filePath),
        mediaIds: unique(mediaRefs.flatMap((item) => item.mediaIds ?? (item.mediaId ? [item.mediaId] : []))),
        mediaRefs,
        href: buildPostUrl({ ...sourcePost, ...sourceVersion }, platform),
        layout: stripInternal(sourceVersion.layout ?? null),
        migration: sourceVersion.migration ?? null
      };
      versions.push(version);
    }

    const currentVersion = versions.at(-1) ?? {
      account: platform?.defaultAccount ?? null,
      status: sourcePost.publishedAt ? 'deleted' : 'deleted',
      declaredStatus: 'deleted',
      originalLanguage: defaultLanguage,
      title: {},
      description: {},
      mediaFiles: [],
      mediaIds: [],
      mediaRefs: [],
      href: buildPostUrl(sourcePost, platform),
      layout: null
    };
    posts.push({
      key,
      platform: sourcePost.platform,
      id: String(sourcePost.id),
      publishedAt: sourcePost.publishedAt ?? null,
      versions,
      versionCount: versions.length,
      currentVersionIndex: Math.max(0, versions.length - 1),
      account: currentVersion.account,
      status: currentVersion.status,
      declaredStatus: currentVersion.declaredStatus,
      originalLanguage: currentVersion.originalLanguage,
      title: currentVersion.title,
      description: currentVersion.description,
      mediaFiles: currentVersion.mediaFiles,
      mediaIds: currentVersion.mediaIds,
      mediaRefs: currentVersion.mediaRefs,
      href: currentVersion.href,
      layout: currentVersion.layout,
      source
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
    schemaVersion: 2,
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
      postVersionCount: posts.reduce((sum, post) => sum + post.versions.length, 0),
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

  const mediaIdsByFile = new Map();
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
        for (const filePath of media.files) {
          if (!mediaIdsByFile.has(filePath)) mediaIdsByFile.set(filePath, []);
          mediaIdsByFile.get(filePath).push(String(media.id));
        }
      }
    }
  }

  // Preserve legacy auto-linking while upgrading posts to filename references.
  // Auto-linked filenames are only lookup keys; compileArchive later resolves
  // them back to logical media and chooses that media's lightest display file.
  const filesByPostKey = new Map();
  for (const file of fileCatalog) {
    if (!file.postKey) continue;
    if (!filesByPostKey.has(file.postKey)) filesByPostKey.set(file.postKey, []);
    filesByPostKey.get(file.postKey).push(file.path);
  }

  const appendAutoLinkedFiles = (post, version) => {
    if (!version?.legacyAutoLink) return;
    const key = post.key ?? `${post.platform}:${post.id}`;
    const media = new Set(version.media ?? []);
    for (const filePath of filesByPostKey.get(key) ?? []) {
      if ((mediaIdsByFile.get(filePath)?.length ?? 0) > 0) media.add(filePath);
    }
    version.media = [...media];
  };

  for (const post of source.posts ?? []) {
    if (Array.isArray(post.versions) && post.versions.length > 0) {
      for (const version of post.versions) appendAutoLinkedFiles(post, version);
    } else {
      appendAutoLinkedFiles(post, post);
    }
  }

  const upgraded = upgradeSourcePosts(source);
  source.posts = upgraded.posts;
  source.site = { ...source.site, schemaVersion: 2 };

  return source;
}

export function getLocalizedEntityLabel(entity, language, fallbackLanguage) {
  return localizedValue(entity.title, language, fallbackLanguage) ?? entity.id ?? entity.key;
}
