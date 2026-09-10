import path from 'node:path';
import { buildFileCatalog, extractLegacyMediaId } from './file-catalog.mjs';
import { earliestDate, latestDate, twitterMediaDate } from './dates.mjs';
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


function hasOwn(value, key) {
  return value != null && Object.prototype.hasOwnProperty.call(value, key);
}

function sourcePlatformVersions(platform) {
  if (Array.isArray(platform.versions) && platform.versions.length > 0) return platform.versions;
  return [{
    ...(platform.defaultAccount ? { account: platform.defaultAccount } : {}),
    ...(platform.description ? { description: platform.description } : {}),
    ...(platform.sourceUrl ? { sourceUrl: platform.sourceUrl } : {}),
    ...(hasOwn(platform, 'avatar') ? { avatar: platform.avatar } : {}),
    ...(hasOwn(platform, 'banner') ? { banner: platform.banner } : {})
  }];
}

function normalizedOptionalAsset(version, key) {
  if (!hasOwn(version, key)) return undefined;
  if (version[key] === null) return null;
  return normalizePath(version[key]);
}

function platformAssetPaths(platforms) {
  const result = new Set();
  for (const platform of platforms) {
    if (platform?.icon) result.add(normalizePath(platform.icon));
    for (const version of sourcePlatformVersions(platform ?? {})) {
      if (typeof version?.avatar === 'string' && version.avatar) result.add(normalizePath(version.avatar));
      if (typeof version?.banner === 'string' && version.banner) result.add(normalizePath(version.banner));
    }
  }
  return result;
}

function assetDirectory(filePath) {
  const normalized = normalizePath(filePath);
  const slashIndex = normalized.indexOf('/');
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : null;
}

function normalizeViewerAnchor(value, declaredFiles, displayFile, filesByPath, issues, entityId, source) {
  if (value == null) return { viewerAnchor: null, viewerAlignment: null };

  const points = Array.isArray(value?.points)
    ? value.points.map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
    : [];
  const validPointShape = points.length === 2 && points.every((point) =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0
  );
  const span = validPointShape
    ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
    : 0;

  const requestedReference = typeof value?.file === 'string' && value.file.trim()
    ? normalizePath(value.file)
    : null;
  const referenceFile = requestedReference
    ?? declaredFiles.find((filePath) => {
      const file = filesByPath.get(filePath);
      return file?.width > 0 && file?.height > 0 && file.mimeType?.startsWith('image/');
    })
    ?? null;
  const reference = referenceFile ? filesByPath.get(referenceFile) : null;
  const referenceDeclared = !requestedReference || declaredFiles.includes(requestedReference);
  const referenceUsable = reference?.width > 0 && reference?.height > 0 && reference.mimeType?.startsWith('image/');
  const displayUsable = displayFile?.width > 0 && displayFile?.height > 0 && displayFile.mimeType?.startsWith('image/');
  const pointsInBounds = validPointShape && referenceUsable && points.every((point) =>
    point.x <= reference.width && point.y <= reference.height
  );

  if (!validPointShape || span <= 1e-9 || !referenceDeclared || !referenceUsable || !displayUsable || !pointsInBounds) {
    const details = [];
    if (!validPointShape) details.push('viewerAnchor.points must contain exactly two finite non-negative {x, y} pixel coordinates');
    else if (span <= 1e-9) details.push('viewerAnchor.points must be two distinct points');
    if (!referenceDeclared) details.push("viewerAnchor.file must name one of this media item's declared files");
    if (!referenceUsable) details.push('viewerAnchor requires a declared image file with known pixel dimensions');
    if (referenceUsable && !pointsInBounds) details.push(`viewerAnchor points must fit inside ${reference.width}x${reference.height} reference pixels`);
    if (!displayUsable) details.push('viewerAnchor requires the selected display file to be an image with known pixel dimensions');
    issues.add({
      severity: 'error',
      code: 'media.viewer-anchor-invalid',
      entityType: 'media',
      entityId,
      source,
      details
    });
    return { viewerAnchor: null, viewerAlignment: null };
  }

  const scaleX = displayFile.width / reference.width;
  const scaleY = displayFile.height / reference.height;
  return {
    viewerAnchor: {
      file: referenceFile,
      points
    },
    viewerAlignment: {
      points: points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }))
    }
  };
}

function compilePlatforms(sourcePlatforms, filesByPath, issues, options) {
  return sourcePlatforms.map((sourcePlatform) => {
    const versions = sourcePlatformVersions(sourcePlatform).map((sourceVersion, index) => {
      const avatar = normalizedOptionalAsset(sourceVersion, 'avatar');
      const banner = normalizedOptionalAsset(sourceVersion, 'banner');
      const entityId = `${sourcePlatform.id}#${index + 1}`;

      for (const [kind, filePath] of [['avatar', avatar], ['banner', banner]]) {
        if (typeof filePath !== 'string' || filesByPath.has(filePath)) continue;
        issues.add({
          severity: options.previewPlaceholders ? 'warning' : 'error',
          code: `platform.${kind}-missing`,
          entityType: 'platformVersion',
          entityId,
          source: sourceName(sourcePlatform),
          details: filePath
        });
      }

      return {
        index,
        observedAt: sourceVersion.observedAt ?? null,
        account: sourceVersion.account ?? sourcePlatform.defaultAccount ?? null,
        description: sourceVersion.description ?? {},
        sourceUrl: sourceVersion.sourceUrl ?? null,
        avatar,
        banner
      };
    });

    const currentVersion = versions.at(-1) ?? {
      index: 0,
      observedAt: null,
      account: sourcePlatform.defaultAccount ?? null,
      description: {},
      sourceUrl: null,
      avatar: undefined,
      banner: undefined
    };
    const {
      versions: ignoredVersions,
      description: ignoredDescription,
      sourceUrl: ignoredSourceUrl,
      avatar: ignoredAvatar,
      banner: ignoredBanner,
      ...stablePlatform
    } = sourcePlatform;

    return {
      ...stripInternal(stablePlatform),
      versions,
      currentVersionIndex: Math.max(0, versions.length - 1),
      account: currentVersion.account,
      description: currentVersion.description,
      sourceUrl: currentVersion.sourceUrl,
      avatar: currentVersion.avatar,
      banner: currentVersion.banner
    };
  });
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

function inferTwitterMediaUpload(filePath) {
  const normalized = normalizePath(filePath);
  const slashIndex = normalized.indexOf('/');
  if ((slashIndex >= 0 ? normalized.slice(0, slashIndex) : '') !== 'twitter') return null;

  let filename = path.posix.basename(normalized);
  if (/^\d{4}-\d{2}-\d{2}_/.test(filename)) filename = filename.slice(11);
  const stem = filename.slice(0, filename.length - path.posix.extname(filename).length);

  // Filenames beginning with a decimal snowflake already identify a known
  // tweet and should be represented by a normal source post, not by recovery.
  if (/^\d+[_-]/.test(stem)) return null;

  const mediaId = extractLegacyMediaId(normalized);
  if (!/^[A-Za-z0-9_-]{12,16}$/.test(mediaId)) return null;
  const uploadedAt = twitterMediaDate(mediaId);
  const timestamp = uploadedAt ? Date.parse(uploadedAt) : Number.NaN;
  if (Number.isNaN(timestamp) || timestamp < 1288834974657 || timestamp > Date.now() + 24 * 60 * 60 * 1000) return null;
  return { filePath: normalized, mediaId, uploadedAt };
}

const RECOVERED_TWITTER_GROUP_WINDOW_MS = 60 * 1000;
const RECOVERED_TWITTER_MAX_MEDIA = 4;

function groupRecoveredTwitterCandidates(entries) {
  const sorted = [...entries].sort((a, b) =>
    Date.parse(a.inferred.uploadedAt) - Date.parse(b.inferred.uploadedAt)
      || a.media.id.localeCompare(b.media.id)
  );
  const groups = [];
  let current = [];
  let groupStartedAt = null;

  for (const entry of sorted) {
    const uploadedAt = Date.parse(entry.inferred.uploadedAt);
    const fitsTimeWindow = current.length === 0
      || uploadedAt - groupStartedAt <= RECOVERED_TWITTER_GROUP_WINDOW_MS;
    const fitsMediaLimit = current.length < RECOVERED_TWITTER_MAX_MEDIA;

    if (current.length > 0 && (!fitsTimeWindow || !fitsMediaLimit)) {
      groups.push(current);
      current = [];
      groupStartedAt = null;
    }

    if (current.length === 0) groupStartedAt = uploadedAt;
    current.push(entry);
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

function appendRecoveredTwitterPosts(posts, postIds, mediaById, platformsById, defaultLanguage) {
  const platform = platformsById.get('twitter');
  if (!platform) return;

  // A logical media item already tied to a known Twitter post is represented
  // by that post and must not produce a second inferred entry. Unlinked media
  // are clustered by their native Twitter media timestamps, irrespective of
  // artwork/version ownership: known multi-image tweets in this archive often
  // contain media belonging to different artworks or artwork versions.
  const postsByKey = new Map(posts.map((post) => [post.key, post]));
  const candidates = [];
  for (const media of mediaById.values()) {
    const hasKnownTwitterPost = media.postIds.some((postKey) => postsByKey.get(postKey)?.platform === 'twitter');
    if (hasKnownTwitterPost) continue;

    const inferred = media.declaredFiles
      .map((filePath) => inferTwitterMediaUpload(filePath))
      .filter(Boolean)
      .sort((a, b) => Date.parse(a.uploadedAt) - Date.parse(b.uploadedAt) || a.filePath.localeCompare(b.filePath))[0];
    if (!inferred) continue;

    candidates.push({ media, inferred });
  }

  for (const entries of groupRecoveredTwitterCandidates(candidates)) {
    const primaryMediaId = entries[0].inferred.mediaId;
    const groupIdentity = entries.map(({ media }) => media.id).join('|');
    let id = `lost-${primaryMediaId}`;
    let key = `twitter:${id}`;
    if (postIds.has(key)) {
      id = `lost-${primaryMediaId}-${stableHash(groupIdentity, 8)}`;
      key = `twitter:${id}`;
    }
    if (postIds.has(key)) continue;

    const mediaRefs = entries.map(({ media, inferred }) => ({
      filePath: inferred.filePath,
      mediaId: media.id,
      mediaIds: [media.id],
      displayFile: media.displayFile ?? null
    }));
    const publishedAt = latestDate(entries.map(({ inferred }) => inferred.uploadedAt));
    const recovery = {
      kind: 'media-only',
      dateSource: 'twitter-media-id',
      sourceMediaIds: entries.map(({ inferred }) => inferred.mediaId),
      groupingWindowSeconds: RECOVERED_TWITTER_GROUP_WINDOW_MS / 1000
    };
    const version = {
      index: 0,
      account: platform.defaultAccount ?? null,
      status: 'lost',
      declaredStatus: 'lost',
      originalLanguage: defaultLanguage,
      title: {},
      description: {},
      mediaFiles: mediaRefs.map((item) => item.filePath),
      mediaIds: mediaRefs.map((item) => item.mediaId),
      mediaRefs,
      href: null,
      layout: null,
      migration: null,
      recovery
    };
    const post = {
      key,
      platform: 'twitter',
      id,
      publishedAt,
      dateApproximate: true,
      versions: [version],
      versionCount: 1,
      currentVersionIndex: 0,
      account: version.account,
      status: version.status,
      declaredStatus: version.declaredStatus,
      originalLanguage: version.originalLanguage,
      title: version.title,
      description: version.description,
      mediaFiles: version.mediaFiles,
      mediaIds: version.mediaIds,
      mediaRefs: version.mediaRefs,
      href: null,
      layout: null,
      recovery,
      source: null
    };

    postIds.add(key);
    posts.push(post);
    for (const { media } of entries) media.postIds.push(key);
  }
}

export async function compileArchive(source, options = {}) {
  const issues = new IssueCollector();
  const languages = source.site.languages ?? ['ru', 'en', 'ja'];
  const defaultLanguage = source.site.defaultLanguage ?? languages[0] ?? 'en';
  const sourcePlatforms = Array.isArray(source.platforms) ? source.platforms : source.platforms.platforms ?? [];
  const platformAssets = platformAssetPaths(sourcePlatforms);
  const platformAssetDirectories = [...platformAssets].map(assetDirectory).filter(Boolean);
  const knownPostIds = source.posts.map((post) => ({
    key: post.key ?? `${post.platform}:${post.id}`,
    platform: post.platform,
    id: String(post.id)
  }));
  const files = options.mediaRoot
    ? await buildFileCatalog(options.mediaRoot, {
      includeDirectories: unique([
        ...(source.site.mediaDirectories ?? ['twitter', 'tumblr', 'pixiv', 'other']),
        ...platformAssetDirectories
      ]),
      knownPostIds
    })
    : [];
  const filesByPath = new Map(files.map((file) => [normalizePath(file.path), file]));
  const platforms = compilePlatforms(sourcePlatforms, filesByPath, issues, options);
  const platformsById = new Map(platforms.map((platform) => [platform.id, platform]));
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

        const viewerAnchor = normalizeViewerAnchor(
          sourceMedia.viewerAnchor,
          declaredFiles,
          displayFile,
          filesByPath,
          issues,
          mediaId,
          sourceName(sourceArtwork)
        );
        const compiledMedia = {
          id: mediaId,
          artworkId,
          versionId,
          viewerAnchor: viewerAnchor.viewerAnchor,
          viewerAlignment: viewerAnchor.viewerAlignment,
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

  appendRecoveredTwitterPosts(posts, postIds, mediaById, platformsById, defaultLanguage);

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
    if (platformAssets.has(file.path)) continue;
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
  source.platforms = upgraded.platforms;
  source.site = { ...source.site, schemaVersion: 2 };

  return source;
}

export function getLocalizedEntityLabel(entity, language, fallbackLanguage) {
  return localizedValue(entity.title, language, fallbackLanguage) ?? entity.id ?? entity.key;
}
