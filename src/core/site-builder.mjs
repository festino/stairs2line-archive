import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDate, localeText, localizedValue } from './localization.mjs';
import { compareNullableDates, copyDirectory, ensureDirectory, escapeAttribute, escapeHtml, stableHash } from './util.mjs';

const SCOPE_FILTERS = {
  popular: ['top'],
  major: ['top', 'major'],
  versions: ['top', 'major', 'sketchy'],
  all: ['top', 'major', 'sketchy', 'decorative']
};

function linkify(input) {
  if (typeof input != "string") return input;

  const re = /\{([^{}|]+)\|(https:\/\/[^{}\s]+)\}/g;

  let result = "";
  let lastIndex = 0;
  let match;

  while ((match = re.exec(input)) !== null) {
    const [whole, label, url] = match;

    result += escapeHtml(input.slice(lastIndex, match.index));

    result += '<a href="' + escapeAttribute(url) + '" target="_blank" rel="noreferrer">' + escapeHtml(label) + "</a>";

    lastIndex = match.index + whole.length;
  }

  result += escapeHtml(input.slice(lastIndex));

  return result;
}

function stripLinks(input) {
    if (typeof input != "string") return input;

    const re = /\{([^{}|]+)\|(https:\/\/[^{}\s]+)\}/g;

    return input.replace(re, (_, label) => label);
}

function normalizeBasePath(value) {
  const trimmed = String(value ?? '/').trim();
  if (!trimmed || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

function joinUrl(basePath, relative) {
  const base = normalizeBasePath(basePath);
  const clean = String(relative ?? '').replace(/^\/+/, '');
  return base === '/' ? `/${clean}` : `${base}${clean}`;
}

function absoluteUrl(manifest, urlPath) {
  const origin = String(manifest.site.origin ?? '').replace(/\/+$/, '');
  return origin ? `${origin}${urlPath.startsWith('/') ? '' : '/'}${urlPath}` : urlPath;
}

function routeUrl(manifest, language, relative = '') {
  const route = `${language}/${String(relative).replace(/^\/+/, '')}`;
  return joinUrl(manifest.site.basePath, route);
}

function mediaUrl(manifest, filePath) {
  const file = manifest.files[filePath];
  if (file?.placeholder) return joinUrl(manifest.site.basePath, filePath);
  const mediaBase = String(manifest.site.mediaBasePath ?? 'media/stairs2line/').replace(/^\/+/, '').replace(/\/+$/, '');
  return joinUrl(manifest.site.basePath, `${mediaBase}/${filePath}`);
}

function platformIconUrl(manifest, platform) {
  if (!platform?.icon) return null;
  const mediaBase = String(manifest.site.mediaBasePath ?? 'media/stairs2line/').replace(/^\/+/, '').replace(/\/+$/, '');
  return joinUrl(manifest.site.basePath, `${mediaBase}/${platform.icon}`);
}


function currentPlatformVersion(platform) {
  return platform?.versions?.at(-1) ?? platform ?? {};
}

function platformProfileAssetUrl(manifest, filePath) {
  if (!filePath || !manifest.files[filePath]) return null;
  return mediaUrl(manifest, filePath);
}

function platformAvatarUrl(manifest, platform) {
  const profile = currentPlatformVersion(platform);
  if (Object.prototype.hasOwnProperty.call(profile, 'avatar')) {
    return profile.avatar === null ? null : platformProfileAssetUrl(manifest, profile.avatar);
  }
  return platformIconUrl(manifest, platform);
}

function platformBannerUrl(manifest, platform) {
  const profile = currentPlatformVersion(platform);
  return typeof profile.banner === 'string' ? platformProfileAssetUrl(manifest, profile.banner) : null;
}

function platformBannerKnownAbsent(platform) {
  const profile = currentPlatformVersion(platform);
  return Object.prototype.hasOwnProperty.call(profile, 'banner') && profile.banner === null;
}

function platformSourceUrl(platform) {
  const profile = currentPlatformVersion(platform);
  return typeof profile.sourceUrl === 'string' && profile.sourceUrl.trim()
    ? profile.sourceUrl.trim()
    : null;
}

function outputFile(outputRoot, language, relative = '') {
  const clean = String(relative).replace(/^\/+|\/+$/g, '');
  return path.join(outputRoot, language, clean, 'index.html');
}

function pageRelative(baseRelative, page) {
  if (page <= 1) return baseRelative;
  return `${baseRelative.replace(/\/+$/, '')}/page/${page}`;
}

function languageLinks(manifest, relative) {
  return manifest.languages.map((language) => ({
    language,
    href: absoluteUrl(manifest, routeUrl(manifest, language, relative))
  }));
}

function platformLabel(platform, language, fallbackLanguage) {
  return localizedValue(platform?.label, language, fallbackLanguage) ?? platform?.id ?? 'Unknown';
}

function displayTitle(entity, language, fallbackLanguage) {
  return localizedValue(entity.title, language, fallbackLanguage);
}

function displayDescription(entity, language, fallbackLanguage) {
  return localizedValue(entity.description, language, fallbackLanguage);
}

function mediaElement(manifest, media, language, alt, contextType, contextId, options = {}) {
  if (!media?.displayFile) return '';
  const file = manifest.files[media.displayFile];
  if (!file) return '';
  const src = mediaUrl(manifest, file.path);
  const sizeAttributes = file.width && file.height
    ? ` width="${file.width}" height="${file.height}"`
    : '';
  const dataAttributes = [
    'data-viewer-media',
    `data-media-id="${escapeAttribute(media.id)}"`,
    `data-file-path="${escapeAttribute(file.path)}"`,
    `data-context-type="${escapeAttribute(contextType)}"`,
    `data-context-id="${escapeAttribute(contextId)}"`,
    ...(options.viewerAlignGroup ? [
      'data-viewer-align="artwork"',
      `data-viewer-align-group="${escapeAttribute(options.viewerAlignGroup)}"`,
      ...(media.viewerAlignment?.points?.length === 2 ? [
        `data-viewer-anchor-x1="${escapeAttribute(media.viewerAlignment.points[0].x)}"`,
        `data-viewer-anchor-y1="${escapeAttribute(media.viewerAlignment.points[0].y)}"`,
        `data-viewer-anchor-x2="${escapeAttribute(media.viewerAlignment.points[1].x)}"`,
        `data-viewer-anchor-y2="${escapeAttribute(media.viewerAlignment.points[1].y)}"`,
        ...(media.viewerAlignment.flipX ? ['data-viewer-flip-x="true"'] : []),
        ...(Number.isFinite(media.viewerAlignment.rotation) && media.viewerAlignment.rotation !== 0
          ? [`data-viewer-rotation="${escapeAttribute(media.viewerAlignment.rotation)}"`]
          : [])
      ] : [])
    ] : []),
    ...(options.freezeAnimation && file.mimeType === 'image/gif' ? ['data-gallery-static-gif="true"'] : [])
  ].join(' ');

  if (file.mimeType?.startsWith('video/')) {
    const controls = options.videoPreview ? '' : ' controls';
    return `<a class="media-link" href="${escapeAttribute(src)}">
      <video ${dataAttributes}${sizeAttributes}${controls} preload="metadata" playsinline aria-label="${escapeAttribute(alt)}">
        <source src="${escapeAttribute(src)}" type="${escapeAttribute(file.mimeType)}">
      </video>
    </a>`;
  }

  const eager = options.eager ? ' fetchpriority="high"' : ' loading="lazy"';
  return `<a class="media-link" href="${escapeAttribute(src)}">
    <img ${dataAttributes} src="${escapeAttribute(src)}"${sizeAttributes}${eager} decoding="async" alt="${escapeAttribute(alt)}">
  </a>`;
}

function mediaRefElement(manifest, mediaRef, language, alt, contextType, contextId, options = {}) {
  const filePath = mediaRef?.displayFile ?? mediaRef?.filePath;
  if (!filePath) return '';
  const file = manifest.files[filePath];
  if (!file) return '';
  const src = mediaUrl(manifest, file.path);
  const sizeAttributes = file.width && file.height
    ? ` width="${file.width}" height="${file.height}"`
    : '';
  const dataAttributes = [
    'data-viewer-media',
    `data-media-id="${escapeAttribute(mediaRef.mediaId ?? '')}"`,
    `data-file-path="${escapeAttribute(mediaRef.filePath ?? file.path)}"`,
    `data-context-type="${escapeAttribute(contextType)}"`,
    `data-context-id="${escapeAttribute(contextId)}"`,
    ...(Number.isInteger(options.versionIndex) ? [`data-context-version="${options.versionIndex}"`] : [])
  ].join(' ');

  if (file.mimeType?.startsWith('video/')) {
    return `<a class="media-link" href="${escapeAttribute(src)}">
      <video ${dataAttributes}${sizeAttributes} controls preload="metadata" aria-label="${escapeAttribute(alt)}">
        <source src="${escapeAttribute(src)}" type="${escapeAttribute(file.mimeType)}">
      </video>
    </a>`;
  }

  const eager = options.eager ? ' fetchpriority="high"' : ' loading="lazy"';
  return `<a class="media-link" href="${escapeAttribute(src)}">
    <img ${dataAttributes} src="${escapeAttribute(src)}"${sizeAttributes}${eager} decoding="async" alt="${escapeAttribute(alt)}">
  </a>`;
}

function renderPlatformLinks(manifest, media, language) {
  const postsByKey = new Map(manifest.posts.map((post) => [post.key, post]));
  const platformsById = new Map(manifest.platforms.map((platform) => [platform.id, platform]));
  const links = [];
  for (const postId of media.postIds ?? []) {
    const post = postsByKey.get(postId);
    const platform = platformsById.get(post?.platform);
    if (!post || !platform) continue;
    const icon = platformIconUrl(manifest, platform);
    const label = platformLabel(platform, language, manifest.defaultLanguage);
    const href = post.href ?? routeUrl(manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}/`);
    const external = Boolean(post.href);
    links.push(`<a class="platform-link ${post.status === 'deleted' || post.status === 'lost' ? 'is-deleted' : ''}" href="${escapeAttribute(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''} title="${escapeAttribute(label)}">${icon ? `<img src="${escapeAttribute(icon)}" alt="">` : escapeHtml(label)}</a>`);
  }
  return links.length > 0 ? `<div class="platform-links">${links.join('')}</div>` : '';
}

function renderArtworkCard(manifest, artwork, version, language, index) {
  const media = manifest.media[version.mediaIds[0]];
  const title = displayTitle(artwork, language, manifest.defaultLanguage);
  const description = displayDescription(artwork, language, manifest.defaultLanguage);
  const date = artwork.sortAt ? formatDate(artwork.sortAt, language, { includeTime: false }) : null;
  const href = routeUrl(manifest, language, `artworks/${artwork.slug}/`);
  return `<article class="card artwork-card" data-list-item data-artwork-id="${escapeAttribute(artwork.id)}">
    <div class="card-media">
      ${mediaElement(manifest, media, language, title, 'artworkVersion', version.key, { eager: index === 0 })}
      ${media ? renderPlatformLinks(manifest, media, language) : ''}
    </div>
    <div class="card-body">
      <p class="metadata"><a href="${escapeAttribute(href)}">${date ? escapeHtml(date) : escapeHtml(localeText(manifest.locales, language, 'common.unknownDate'))}</a></p>
    </div>
  </article>`;
}

function orientationMatrix(flipX = false, rotation = 0) {
  const radians = rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const mirror = flipX ? -1 : 1;
  return {
    a: cos * mirror,
    b: sin * mirror,
    c: -sin,
    d: cos
  };
}

function orientPoint(point, width, height, matrix) {
  const centerX = width / 2;
  const centerY = height / 2;
  const x = point.x - centerX;
  const y = point.y - centerY;
  return {
    x: centerX + matrix.a * x + matrix.c * y,
    y: centerY + matrix.b * x + matrix.d * y
  };
}

function revisionPreviewMedia(manifest, version) {
  const mediaItems = (version?.mediaIds ?? []).map((mediaId) => manifest.media[mediaId]).filter(Boolean);
  return mediaItems.find((media) => {
    const file = media?.displayFile ? manifest.files[media.displayFile] : null;
    return file?.mimeType?.startsWith('image/') && file.width > 0 && file.height > 0;
  }) ?? mediaItems[0] ?? null;
}

function nonDecorativeRevisionVersions(manifest, artwork) {
  return (artwork?.versions ?? []).filter((version) =>
    version.scope !== 'decorative' && revisionPreviewMedia(manifest, version)?.displayFile
  );
}

function revisionGeometry(manifest, media) {
  const file = media?.displayFile ? manifest.files[media.displayFile] : null;
  if (!file?.mimeType?.startsWith('image/') || !(file.width > 0) || !(file.height > 0)) return null;
  const alignment = media.viewerAlignment ?? {};
  const rawPoints = alignment.points?.length === 2
    ? alignment.points
    : [
      { x: file.width / 2, y: 0 },
      { x: file.width / 2, y: file.height }
    ];
  const matrix = orientationMatrix(Boolean(alignment.flipX), Number(alignment.rotation ?? 0));
  const points = rawPoints.map((point) => orientPoint(point, file.width, file.height, matrix));
  const corners = [
    { x: 0, y: 0 },
    { x: file.width, y: 0 },
    { x: file.width, y: file.height },
    { x: 0, y: file.height }
  ].map((point) => orientPoint(point, file.width, file.height, matrix));
  const center = {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2
  };
  const span = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  if (!(span > 0)) return null;
  return { file, media, width: file.width, height: file.height, points, corners, center, span, matrix };
}

function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

function lineIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < 1e-9) return b;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

function intersectConvexPolygons(subjectPolygon, clipPolygon) {
  if (subjectPolygon.length < 3 || clipPolygon.length < 3) return [];
  let output = subjectPolygon.slice();
  const orientation = polygonArea(clipPolygon) >= 0 ? 1 : -1;
  const inside = (a, b, point) => orientation * ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) >= -1e-7;

  for (let index = 0; index < clipPolygon.length; index += 1) {
    const clipStart = clipPolygon[index];
    const clipEnd = clipPolygon[(index + 1) % clipPolygon.length];
    const input = output;
    output = [];
    if (input.length === 0) break;
    let previous = input.at(-1);
    for (const current of input) {
      const currentInside = inside(clipStart, clipEnd, current);
      const previousInside = inside(clipStart, clipEnd, previous);
      if (currentInside) {
        if (!previousInside) output.push(lineIntersection(previous, current, clipStart, clipEnd));
        output.push(current);
      } else if (previousInside) {
        output.push(lineIntersection(previous, current, clipStart, clipEnd));
      }
      previous = current;
    }
  }
  return output;
}

function alignedRevisionPreview(manifest, artwork, versions, language) {
  const items = versions.map((version) => ({ version, media: revisionPreviewMedia(manifest, version) }));
  const geometries = items.map((item) => revisionGeometry(manifest, item.media));
  const detailHref = routeUrl(manifest, language, `artworks/${artwork.slug}/`);
  const title = displayTitle(artwork, language, manifest.defaultLanguage) ?? artwork.id;
  const singleClass = versions.length === 1 ? ' revision-preview-link--single' : '';

  if (geometries.some((geometry) => !geometry)) {
    return `<a class="revision-preview-link revision-preview-link--fallback${singleClass}" href="${escapeAttribute(detailHref)}">${items.map((item) => `<span class="revision-preview-frame">${item.media ? compactMediaElement(manifest, item.media, title) : ''}</span>`).join('')}</a>`;
  }

  const reference = geometries[0];
  const placements = geometries.map((geometry) => {
    const scale = reference.span / geometry.span;
    const left = reference.center.x - geometry.center.x * scale;
    const top = reference.center.y - geometry.center.y * scale;
    const corners = geometry.corners.map((corner) => ({ x: left + corner.x * scale, y: top + corner.y * scale }));
    const centerX = geometry.width / 2;
    const centerY = geometry.height / 2;
    const matrix = geometry.matrix;
    return {
      geometry,
      corners,
      transform: {
        a: matrix.a * scale,
        b: matrix.b * scale,
        c: matrix.c * scale,
        d: matrix.d * scale,
        e: left + scale * (centerX - matrix.a * centerX - matrix.c * centerY),
        f: top + scale * (centerY - matrix.b * centerX - matrix.d * centerY)
      }
    };
  });

  // Keep the alignment/zoom defined by the first (earliest) preview version.
  // Other versions are transformed into that same coordinate system, but we
  // deliberately do not add an inner clipPath. The only clipping is the
  // rectangular preview frame itself, which keeps the useful comparison zoom
  // without cutting every image down to the common intersection polygon.
  const corners = placements[0].corners;
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  if (!(width > 0) || !(height > 0)) return '';
  const viewBox = `${minX.toFixed(4)} ${minY.toFixed(4)} ${width.toFixed(4)} ${height.toFixed(4)}`;

  const frames = placements.map((placement) => {
    const file = placement.geometry.file;
    const src = mediaUrl(manifest, file.path);
    const transform = placement.transform;
    return `<span class="revision-preview-frame"><svg viewBox="${viewBox}" role="img" aria-label="${escapeAttribute(title)}" preserveAspectRatio="xMidYMid meet">
      <image href="${escapeAttribute(src)}" width="${placement.geometry.width}" height="${placement.geometry.height}" preserveAspectRatio="none" transform="matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})"></image>
    </svg></span>`;
  }).join('');
  return `<a class="revision-preview-link${singleClass}" href="${escapeAttribute(detailHref)}">${frames}</a>`;
}

function revisionVersionOrder(artwork, versions = artwork.versions) {
  return versions
    .map((version, index) => ({ version, index, time: version.sortAt ? Date.parse(version.sortAt) : Number.NaN }))
    .sort((a, b) => {
      const aMissing = Number.isNaN(a.time);
      const bMissing = Number.isNaN(b.time);
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      if (!aMissing && a.time !== b.time) return a.time - b.time;
      return a.index - b.index;
    });
}

function revisionDateBounds(artwork, versions = artwork.versions) {
  const dated = revisionVersionOrder(artwork, versions).filter((item) => !Number.isNaN(item.time));
  return {
    earliest: dated[0]?.version ?? null,
    latest: dated.at(-1)?.version ?? null
  };
}

function revisionIntervalMs(artwork, versions = artwork.versions) {
  const dated = revisionVersionOrder(artwork, versions).filter((item) => !Number.isNaN(item.time));
  if (dated.length < 2) return null;
  return Math.max(0, dated.at(-1).time - dated[0].time);
}

function revisionPreviewVersions(artwork, versions = artwork.versions) {
  const ordered = revisionVersionOrder(artwork, versions);
  const dated = ordered.filter((item) => !Number.isNaN(item.time));
  const first = dated[0]?.version ?? ordered[0]?.version ?? null;
  const last = dated.at(-1)?.version ?? ordered.at(-1)?.version ?? null;
  if (!first || !last) return [];
  if (first.key === last.key) {
    const alternative = ordered.find((item) => item.version.key !== first.key)?.version;
    return alternative ? [first, alternative] : [first];
  }
  return [first, last];
}

function revisionDateRangeText(manifest, artwork, language, versions = artwork.versions) {
  const { earliest, latest } = revisionDateBounds(artwork, versions);
  if (!earliest?.sortAt && !latest?.sortAt) return localeText(manifest.locales, language, 'common.unknownDate');
  const first = earliest?.sortAt ? formatDate(earliest.sortAt, language, { includeTime: false }) : null;
  const last = latest?.sortAt ? formatDate(latest.sortAt, language, { includeTime: false }) : null;
  if (!first || !last || first === last) return first ?? last ?? localeText(manifest.locales, language, 'common.unknownDate');
  return `${first} — ${last}`;
}

function renderRevisionCard(manifest, artwork, language, eligibleVersions = artwork.versions) {
  const versions = revisionPreviewVersions(artwork, eligibleVersions);
  const href = routeUrl(manifest, language, `artworks/${artwork.slug}/`);
  const dateRange = revisionDateRangeText(manifest, artwork, language, eligibleVersions);
  const singleClass = eligibleVersions.length === 1 ? ' revision-card--single' : '';
  return `<article class="card revision-card${singleClass}" data-list-item data-artwork-id="${escapeAttribute(artwork.id)}">
    ${alignedRevisionPreview(manifest, artwork, versions, language)}
    <div class="card-body revision-card-body">
      <p class="metadata"><a href="${escapeAttribute(href)}">${escapeHtml(dateRange)}</a></p>
    </div>
  </article>`;
}

function renderGalleryItem(manifest, artwork, version, language, index, options = {}) {
  const media = revisionPreviewMedia(manifest, version);
  if (!media?.displayFile) return '';
  const file = manifest.files[media.displayFile];
  const title = displayTitle(artwork, language, manifest.defaultLanguage) ?? artwork.id;
  const ratio = file?.width > 0 && file?.height > 0 ? file.width / file.height : 1;
  const baseHeight = 184;
  const isWide = ratio > 2;
  // Regular images share one visual height. Panoramas are the exception:
  // cap their width and reduce their row height proportionally rather than
  // blowing them up into long strips or letterboxing them inside a tall box.
  const targetWidth = isWide
    ? Math.max(72, Math.min(300, baseHeight * ratio))
    : Math.max(72, baseHeight * ratio);
  const targetHeight = isWide ? targetWidth / ratio : baseHeight;
  const separator = options.startsUndatedGroup ? '<div class="gallery-date-divider" aria-hidden="true"></div>' : '';
  const isMotion = file?.mimeType?.startsWith('video/') || file?.mimeType === 'image/gif';
  const motionIndicator = isMotion
    ? '<span class="gallery-video-indicator" aria-hidden="true">▶</span>'
    : '';
  return `${separator}<div class="gallery-item${isWide ? ' gallery-item--wide' : ''}" style="--gallery-width:${escapeAttribute(targetWidth.toFixed(2))}px;--gallery-height:${targetHeight}px;--gallery-aspect:${escapeAttribute(ratio.toFixed(5))}" data-list-item data-version-id="${escapeAttribute(version.key)}">
    ${mediaElement(manifest, media, language, title, 'artworkVersion', version.key, { eager: index < 4, videoPreview: true, freezeAnimation: true })}
    ${motionIndicator}
  </div>`;
}

function renderVersionCard(manifest, artwork, version, language, index) {
  const media = manifest.media[version.mediaIds[0]];
  const title = displayTitle(artwork, language, manifest.defaultLanguage);
  const versionTitle = `${title} · ${version.id}`;
  const date = version.sortAt ? formatDate(version.sortAt, language, { includeTime: false }) : null;
  const href = `${routeUrl(manifest, language, `artworks/${artwork.slug}/`)}#${encodeURIComponent(version.id)}`;
  return `<article class="card version-card" data-list-item data-version-id="${escapeAttribute(version.key)}">
    <div class="card-media">
      ${mediaElement(manifest, media, language, versionTitle, 'artworkVersion', version.key, { eager: index === 0 })}
      ${media ? renderPlatformLinks(manifest, media, language) : ''}
    </div>
    <div class="card-body">
      <p class="metadata"><a href="${escapeAttribute(href)}">${date ? escapeHtml(date) : escapeHtml(localeText(manifest.locales, language, 'common.unknownDate'))}</a></p>
    </div>
  </article>`;
}

function latestPostVersion(post) {
  return post.versions?.at(-1) ?? post;
}

function isRecoveredMediaOnly(post) {
  return post?.recovery?.kind === 'media-only';
}

function displayPostDate(manifest, post, language, options = {}) {
  if (!post.publishedAt) return localeText(manifest.locales, language, 'common.unknownDate');
  const date = formatDate(post.publishedAt, language, options);
  return post.dateApproximate
    ? localeText(manifest.locales, language, 'posts.approximateDate', { date })
    : date;
}

function displayApproximateDate(manifest, value, approximate, language, options = {}) {
  if (!value) return localeText(manifest.locales, language, 'common.unknownDate');
  const date = formatDate(value, language, options);
  return approximate
    ? localeText(manifest.locales, language, 'posts.approximateDate', { date })
    : date;
}

function renderPlatformCreatedEvent(manifest, platform, language) {
  if (!platform?.createdAt) return '';
  const icon = platformIconUrl(manifest, platform);
  const label = platformLabel(platform, language, manifest.defaultLanguage);
  const date = displayApproximateDate(manifest, platform.createdAt, platform.dateApproximate, language, { includeTime: false });
  return `<article class="platform-created-event" data-list-item>
    <span class="platform-created-event-icon">${icon ? `<img src="${escapeAttribute(icon)}" alt="">` : '●'}</span>
    <span class="platform-created-event-copy"><strong>${escapeHtml(localeText(manifest.locales, language, 'posts.platformCreated', { platform: label }))}</strong><time datetime="${escapeAttribute(platform.createdAt)}">${escapeHtml(date)}</time></span>
  </article>`;
}

function fallbackPostTitle(manifest, post, platform, language) {
  const label = platformLabel(platform, language, manifest.defaultLanguage);
  return isRecoveredMediaOnly(post)
    ? localeText(manifest.locales, language, 'posts.lostTitle', { platform: label })
    : `${label} ${post.id}`;
}

function defaultTumblrRows(mediaCount) {
  const rows = [];
  let index = 0;
  if (mediaCount % 2 === 1 && mediaCount > 1) {
    rows.push([0]);
    index = 1;
  }
  while (index < mediaCount) {
    rows.push(index + 1 < mediaCount ? [index, index + 1] : [index]);
    index += 2;
  }
  return rows;
}

function tumblrLayoutRows(version) {
  const rows = [];
  for (const section of version.layout ?? []) {
    if (section?.type !== 'rows') continue;
    for (const row of section.display ?? []) {
      if (Array.isArray(row?.blocks) && row.blocks.length > 0) rows.push(row.blocks);
    }
  }
  if (rows.length > 0) return rows;
  return defaultTumblrRows(version.mediaRefs?.length ?? 0);
}

function twitterSingleMediaCropClass(manifest, mediaRef) {
  const filePath = mediaRef?.displayFile ?? mediaRef?.filePath;
  const file = filePath ? manifest.files[filePath] : null;
  if (!file?.width || !file?.height) return 'twitter-single-media--natural';

  const aspectRatio = file.width / file.height;
  if (aspectRatio > 2) return 'twitter-single-media--wide';
  if (aspectRatio < 3 / 4) return 'twitter-single-media--tall';
  return 'twitter-single-media--natural';
}

function renderPostMedia(manifest, post, version, language, index) {
  const mediaRefs = version.mediaRefs ?? post.mediaRefs ?? [];
  if (mediaRefs.length === 0) return '';
  const platform = manifest.platforms.find((item) => item.id === post.platform);
  const title = localizedValue(version.title, language, version.originalLanguage)
    ?? localizedValue(version.description, language, version.originalLanguage)
    ?? fallbackPostTitle(manifest, post, platform, language);

  if (post.platform === 'tumblr') {
    const used = new Set();
    const rows = tumblrLayoutRows(version).map((blocks) => {
      const items = blocks.map((mediaIndex) => {
        const mediaRef = mediaRefs[mediaIndex];
        if (!mediaRef) return '';
        used.add(mediaIndex);
        return `<div class="post-media-item">${mediaRefElement(manifest, mediaRef, language, title, 'post', post.key, { eager: index === 0 && mediaIndex === 0, versionIndex: version.index })}</div>`;
      }).filter(Boolean).join('');
      return items ? `<div class="tumblr-media-row" style="--tumblr-row-columns:${blocks.length}">${items}</div>` : '';
    }).join('');
    const trailing = mediaRefs.map((mediaRef, mediaIndex) => used.has(mediaIndex) ? '' : `<div class="tumblr-media-row" style="--tumblr-row-columns:1"><div class="post-media-item">${mediaRefElement(manifest, mediaRef, language, title, 'post', post.key, { versionIndex: version.index })}</div></div>`).join('');
    return `<div class="post-media-grid tumblr-media-layout">${rows}${trailing}</div>`;
  }

  const platformLayoutClass = post.platform === 'twitter' && mediaRefs.length === 1
    ? ` ${twitterSingleMediaCropClass(manifest, mediaRefs[0])}`
    : '';
  return `<div class="post-media-grid post-media-grid--${escapeAttribute(post.platform)} post-media-count-${mediaRefs.length}${platformLayoutClass}">${mediaRefs.map((mediaRef, mediaIndex) => `<div class="post-media-item">${mediaRefElement(manifest, mediaRef, language, title, 'post', post.key, { eager: index === 0 && mediaIndex === 0, versionIndex: version.index })}</div>`).join('')}</div>`;
}

function renderPostVersionEvidence(manifest, post, version, language) {
  if (post.platform !== 'tumblr' || !version.reblogEvidenceDefined) return '';
  const firstRebloggedAt = version.firstRebloggedAt
    ? formatDate(version.firstRebloggedAt, language, { includeTime: true })
    : null;
  const firstLine = firstRebloggedAt
    ? `<span>${escapeHtml(localeText(manifest.locales, language, 'posts.firstRebloggedAt'))}</span> <time datetime="${escapeAttribute(version.firstRebloggedAt)}">${escapeHtml(firstRebloggedAt)}</time>`
    : `<span>${escapeHtml(localeText(manifest.locales, language, 'posts.firstRebloggedAt'))}</span> ${escapeHtml(localeText(manifest.locales, language, 'posts.noKnownReblogDate'))}`;
  const reblogs = (version.reblogs ?? []).map((reblog) => {
    const label = `@${reblog.blog}`;
    return reblog.href
      ? `<a href="${escapeAttribute(reblog.href)}" target="_blank" rel="noreferrer" title="${escapeAttribute(`${reblog.blog}/${reblog.id}`)}">${escapeHtml(label)}${externalLinkIcon()}</a>`
      : `<span title="${escapeAttribute(`${reblog.blog}/${reblog.id}`)}">${escapeHtml(label)}</span>`;
  });
  const savedReblogsLabel = localeText(manifest.locales, language, 'posts.savedReblogs');
  const reblogDetails = reblogs.length > 0
    ? `<details class="post-reblog-details">
        <summary title="${escapeAttribute(savedReblogsLabel)}" aria-label="${escapeAttribute(`${savedReblogsLabel} ${reblogs.length}`)}">${savedReblogsIcon()}</summary>
        <div class="post-reblog-panel">
          <div class="post-reblog-panel-label">${escapeHtml(savedReblogsLabel)}</div>
          <div class="post-reblog-list">${reblogs.join('<span class="post-reblog-separator"> · </span>')}</div>
        </div>
      </details>`
    : `<span class="post-reblog-empty">${escapeHtml(localeText(manifest.locales, language, 'posts.noSavedReblogs'))}</span>`;
  return `<div class="post-version-evidence">
    <div class="post-version-evidence-row">${firstLine}${reblogDetails}</div>
  </div>`;
}

function renderPostCard(manifest, post, language, index, options = {}) {
  const version = options.version ?? latestPostVersion(post);
  const platform = manifest.platforms.find((item) => item.id === post.platform);
  const label = platformLabel(platform, language, manifest.defaultLanguage);
  const icon = platformIconUrl(manifest, platform);
  const title = displayTitle(version, language, version.originalLanguage);
  const description = displayDescription(version, language, version.originalLanguage);
  const date = displayPostDate(manifest, post, language, { includeTime: true });
  const href = routeUrl(manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}/`);
  const originalHref = version.href ?? post.href ?? null;
  const versionCount = post.versions?.length ?? 1;
  const versionLabel = options.versionLabel ? `<div class="post-version-label">${escapeHtml(options.versionLabel)}</div>` : '';
  const platformMarkup = options.hidePlatform
    ? ''
    : `<a class="post-platform" href="${escapeAttribute(routeUrl(manifest, language, `posts/platform/${encodeURIComponent(post.platform)}/`))}">
        ${icon ? `<img src="${escapeAttribute(icon)}" alt="">` : ''}<span>${escapeHtml(label)}</span>
      </a>`;
  const externalHint = originalHref
    ? `<span class="post-original-link-icon" title="${escapeAttribute(localeText(manifest.locales, language, 'posts.originalPost'))}" aria-label="${escapeAttribute(localeText(manifest.locales, language, 'posts.originalPost'))}">${externalLinkIcon()}</span>`
    : '';
  return `<article class="post-card post-card--${escapeAttribute(post.platform)}" data-list-item data-post-id="${escapeAttribute(post.key)}" data-post-version="${version.index ?? 0}">
    ${versionLabel}
    <header class="post-header">
      ${platformMarkup}
      <a class="post-date" href="${escapeAttribute(originalHref ?? href)}" ${originalHref ? 'target="_blank" rel="noreferrer"' : ''}>
        <time${post.publishedAt ? ` datetime="${escapeAttribute(post.publishedAt)}"` : ''}>${escapeHtml(date)}</time>
        <span class="status status-${escapeAttribute(post.status)}">${escapeHtml(localeText(manifest.locales, language, `common.${post.status}`))}</span>
        ${externalHint}
      </a>
      <a class="post-version-count" href="${escapeAttribute(href)}">${versionCount} ${escapeHtml(localeText(manifest.locales, language, `common.versions`))}</a>
    </header>
    <div class="post-body">
      ${title ? `<h2>${escapeHtml(title)}</h2>` : ''}
      ${description ? `<div class="post-text" lang="${escapeAttribute(version.originalLanguage)}">${linkify(description).replaceAll('\n', '<br>')}</div>` : ''}
      ${isRecoveredMediaOnly(post) ? `<p class="lost-post-note">${escapeHtml(localeText(manifest.locales, language, 'posts.lostMediaOnly'))}</p>` : ''}
      ${options.showVersionEvidence ? renderPostVersionEvidence(manifest, post, version, language) : ''}
      ${renderPostMedia(manifest, post, version, language, index)}
    </div>
    <!--<footer class="post-footer">
      <a href="${escapeAttribute(href)}">${escapeHtml(localeText(manifest.locales, language, 'common.open'))}</a>
      ${post.href ? `<a href="${escapeAttribute(post.href)}" target="_blank" rel="noreferrer">${escapeHtml(localeText(manifest.locales, language, 'common.source'))}</a>` : ''}
    </footer>-->
  </article>`;
}

function layersIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5.5h10a2 2 0 0 1 2 2v10h-2v-10h-10v-2Zm-3 3h10a2 2 0 0 1 2 2v10h-10a2 2 0 0 1-2-2v-10Zm2 2v8h8v-8h-8Z" fill="currentColor"/></svg>`;
}

function externalLinkIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6h-2V7.41l-8.29 8.3-1.42-1.42 8.3-8.29H14V4ZM5 5h6v2H7v10h10v-4h2v6H5V5Z" fill="currentColor"/></svg>`;
}

function savedReblogsIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM9 6h10v2H9V6ZM5 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM9 11h10v2H9v-2ZM5 15.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM9 16h10v2H9v-2Z" fill="currentColor"/></svg>`;
}

function compactMediaElement(manifest, mediaRef, alt) {
  const filePath = mediaRef?.displayFile ?? mediaRef?.filePath;
  if (!filePath) return '<span class="compact-media-placeholder"></span>';
  const file = manifest.files[filePath];
  if (!file) return '<span class="compact-media-placeholder"></span>';
  const src = mediaUrl(manifest, file.path);
  if (file.mimeType?.startsWith('video/')) {
    return `<video src="${escapeAttribute(src)}" muted playsinline preload="metadata" aria-label="${escapeAttribute(alt)}"></video>`;
  }
  return `<img src="${escapeAttribute(src)}" loading="lazy" decoding="async" alt="${escapeAttribute(alt)}">`;
}

function renderCompactPost(manifest, post, language) {
  const version = latestPostVersion(post);
  const mediaRefs = version.mediaRefs ?? [];
  const mediaCount = mediaRefs.length;
  const platform = manifest.platforms.find((item) => item.id === post.platform);
  const title = displayTitle(version, language, version.originalLanguage)
    ?? displayDescription(version, language, version.originalLanguage)
    ?? fallbackPostTitle(manifest, post, platform, language);
  const postHref = routeUrl(manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}/`);
  const date = displayPostDate(manifest, post, language, { includeTime: false });
  const badge = post.platform === 'pixiv' && mediaCount > 1
    ? `<span class="compact-media-count compact-media-count--pixiv">${layersIcon()}<span>${mediaCount}</span></span>`
    : post.platform === 'twitter' && mediaCount > 1
      ? `<span class="compact-media-count compact-media-count--twitter">${layersIcon()}</span>`
      : '';

  const titleMarkup = post.platform === 'pixiv'
    ? `<span class="compact-post-title">${escapeHtml(displayTitle(version, language, version.originalLanguage) ?? '')}</span>`
    : post.platform === 'tumblr'
      ? `<time class="compact-date-tooltip" datetime="${escapeAttribute(post.publishedAt ?? '')}">${escapeHtml(date)}</time>`
      : '';

  const lostBadge = isRecoveredMediaOnly(post)
    ? `<span class="compact-lost-badge">${escapeHtml(localeText(manifest.locales, language, 'common.lost'))}</span>`
    : '';

  return `<a class="compact-post compact-post--${escapeAttribute(post.platform)}${isRecoveredMediaOnly(post) ? ' compact-post--lost' : ''}" data-list-item href="${escapeAttribute(postHref)}" title="${escapeAttribute(post.platform === 'tumblr' ? date : title)}">
    <span class="compact-post-media">${compactMediaElement(manifest, mediaRefs[0], title)}${badge}${lostBadge}</span>
    ${titleMarkup}
  </a>`;
}

function formatMonthYear(value, language) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}


function formatMonthName(monthIndex, language, style = 'short') {
  return new Intl.DateTimeFormat(language, { month: style, timeZone: 'UTC' })
    .format(new Date(Date.UTC(2020, monthIndex, 1)));
}

function activityLevel(count, nonzeroCounts) {
  if (count <= 0) return 0;
  const uniqueCounts = [...new Set(nonzeroCounts)].sort((a, b) => a - b);
  if (uniqueCounts.length === 1) return 3;
  const rank = uniqueCounts.indexOf(count);
  return 1 + Math.round((rank / (uniqueCounts.length - 1)) * 4);
}

function renderActivityPost(manifest, post, language) {
  const version = latestPostVersion(post);
  const mediaRef = version.mediaRefs?.[0] ?? null;
  const platform = manifest.platforms.find((item) => item.id === post.platform);
  const icon = platformIconUrl(manifest, platform);
  const label = platformLabel(platform, language, manifest.defaultLanguage);
  const title = displayTitle(version, language, version.originalLanguage)
    ?? displayDescription(version, language, version.originalLanguage)
    ?? fallbackPostTitle(manifest, post, platform, language);
  const date = displayPostDate(manifest, post, language, { includeTime: false });
  const href = routeUrl(manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}/`);
  return `<a class="activity-post" href="${escapeAttribute(href)}" title="${escapeAttribute(title)}">
    <span class="activity-post-thumbnail">${compactMediaElement(manifest, mediaRef, title)}${icon ? `<span class="activity-post-platform"><img src="${escapeAttribute(icon)}" alt="${escapeAttribute(label)}"></span>` : ''}</span>
    <span class="activity-post-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(date)} · ${escapeHtml(label)}</span></span>
  </a>`;
}

function renderPostActivityMap(manifest, posts, language, direction = 'desc') {
  const byYear = new Map();
  const unknown = [];
  for (const post of posts) {
    const date = post.publishedAt ? new Date(post.publishedAt) : null;
    if (!date || Number.isNaN(date.getTime())) {
      unknown.push(post);
      continue;
    }
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    if (!byYear.has(year)) byYear.set(year, Array.from({ length: 12 }, () => []));
    byYear.get(year)[month].push(post);
  }

  const counts = [...byYear.values()].flatMap((months) => months.map((items) => items.length)).filter(Boolean);
  const years = [...byYear.keys()].sort((a, b) => direction === 'asc' ? a - b : b - a);
  const rows = years.map((year) => {
    const months = byYear.get(year);
    const monthCells = months.map((monthPosts, monthIndex) => {
      const count = monthPosts.length;
      const monthName = formatMonthName(monthIndex, language, 'long');
      const shortName = formatMonthName(monthIndex, language, 'short');
      const label = `${monthName} ${year}`;
      if (count === 0) {
        return `<div class="activity-month activity-month--empty" title="${escapeAttribute(label)}"><span class="activity-month-dot" data-activity-level="0"></span><span class="activity-month-label">${escapeHtml(shortName)}</span></div>`;
      }
      const level = activityLevel(count, counts);
      const sortedPosts = [...monthPosts].sort((a, b) => compareNullableDates(a.publishedAt, b.publishedAt, direction) || a.key.localeCompare(b.key));
      return `<details class="activity-month" title="${escapeAttribute(`${label} · ${localeText(manifest.locales, language, 'posts.publicationCount', { count })}`)}">
        <summary><span class="activity-month-dot" data-activity-level="${level}"><span>${count}</span></span><span class="activity-month-label">${escapeHtml(shortName)}</span></summary>
        <div class="activity-popover">
          <strong class="activity-popover-title">${escapeHtml(label)}</strong>
          <span class="activity-popover-count">${escapeHtml(localeText(manifest.locales, language, 'posts.publicationCount', { count }))}</span>
          <div class="activity-post-list">${sortedPosts.map((post) => renderActivityPost(manifest, post, language)).join('')}</div>
        </div>
      </details>`;
    }).join('');
    return `<section class="activity-year"><h2>${year}</h2><div class="activity-months">${monthCells}</div></section>`;
  }).join('');

  const unknownMarkup = unknown.length > 0
    ? `<section class="activity-unknown"><h2>${escapeHtml(localeText(manifest.locales, language, 'common.unknownDate'))}</h2><div class="activity-post-list">${unknown.map((post) => renderActivityPost(manifest, post, language)).join('')}</div></section>`
    : '';
  return `<section class="post-activity" aria-label="${escapeAttribute(localeText(manifest.locales, language, 'posts.activity'))}">
    <div class="activity-legend"><span>${escapeHtml(localeText(manifest.locales, language, 'posts.lessActivity'))}</span>${[0,1,2,3,4,5].map((level) => `<span class="activity-legend-dot" data-activity-level="${level}"></span>`).join('')}<span>${escapeHtml(localeText(manifest.locales, language, 'posts.moreActivity'))}</span></div>
    ${rows || `<p>${escapeHtml(localeText(manifest.locales, language, 'common.noItems'))}</p>`}
    ${unknownMarkup}
  </section>`;
}

function renderHomeSection(manifest, language, href, titleKey, descriptionKey) {
  return `<a class="home-section-link" href="${escapeAttribute(routeUrl(manifest, language, href))}">
    <strong>${escapeHtml(localeText(manifest.locales, language, titleKey))}</strong>
    <span>${escapeHtml(localeText(manifest.locales, language, descriptionKey))}</span>
  </a>`;
}

async function buildHomePage(outputRoot, manifest, language) {
  const siteTitle = localizedValue(manifest.site.title, language, manifest.defaultLanguage) ?? 'stairs2line';
  const siteDescription = localizedValue(manifest.site.description, language, manifest.defaultLanguage) ?? '';
  const body = `<section class="home-hero">
      <h1>${escapeHtml(siteTitle)}</h1>
      ${siteDescription ? `<p>${escapeHtml(siteDescription)}</p>` : ''}
      <p>${escapeHtml(localeText(manifest.locales, language, 'home.projectDescription'))}</p>
    </section>
    <section class="home-sections" aria-label="${escapeAttribute(localeText(manifest.locales, language, 'home.sectionsTitle'))}">
      ${renderHomeSection(manifest, language, 'gallery/', 'nav.gallery', 'home.galleryDescription')}
      ${renderHomeSection(manifest, language, 'posts/by-platform/', 'nav.socials', 'home.socialsDescription')}
      ${renderHomeSection(manifest, language, 'artworks/', 'nav.revisions', 'home.revisionsDescription')}
    </section>
    <section class="home-activity">
      <h2>${escapeHtml(localeText(manifest.locales, language, 'posts.activity'))}</h2>
      ${renderPostActivityMap(manifest, manifest.posts, language, 'desc')}
    </section>`;
  await writePage(outputRoot, manifest, language, '', layout(manifest, language, '', {
    title: `${siteTitle} · ${localeText(manifest.locales, language, 'nav.home')}`,
    description: siteDescription || localeText(manifest.locales, language, 'home.projectDescription'),
    bodyClass: 'home-page',
    body
  }));
}

function renderCompactListing(manifest, posts, language, platform) {
  if (platform.id !== 'tumblr') {
    return `<section class="compact-grid compact-grid--${escapeAttribute(platform.id)}" data-paged-list>${posts.map((post) => renderCompactPost(manifest, post, language)).join('')}</section>`;
  }

  const groups = [];
  const byKey = new Map();
  for (const post of posts) {
    const date = post.publishedAt ? new Date(post.publishedAt) : null;
    const key = date && !Number.isNaN(date.getTime())
      ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
      : 'unknown';
    if (!byKey.has(key)) {
      const group = { key, first: post, posts: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).posts.push(post);
  }

  return `<section class="tumblr-compact-archive" data-paged-list>${groups.map((group) => `<section class="tumblr-month-group">
    <h2>${escapeHtml(group.key === 'unknown' ? localeText(manifest.locales, language, 'common.unknownDate') : formatMonthYear(group.first.publishedAt, language))}</h2>
    <div class="compact-grid compact-grid--tumblr">${group.posts.map((post) => renderCompactPost(manifest, post, language)).join('')}</div>
  </section>`).join('')}</section>`;
}

function renderPlatformBannerImages(banner) {
  if (!banner) return '';
  const src = escapeAttribute(banner);
  return `<img class="platform-banner-backdrop" src="${src}" alt="" aria-hidden="true"><img class="platform-banner-image" src="${src}" alt="">`;
}

function renderPlatformHero(manifest, platform, language, options = {}) {
  if (!platform) return '';
  const label = platformLabel(platform, language, manifest.defaultLanguage);
  const icon = platformIconUrl(manifest, platform);
  const avatar = platformAvatarUrl(manifest, platform);
  const banner = platformBannerUrl(manifest, platform);
  const profile = currentPlatformVersion(platform);
  const account = profile.account ?? platform.defaultAccount ?? '';
  const bio = localizedValue(profile.description, language, manifest.defaultLanguage);
  const sourceUrl = platformSourceUrl(platform);
  const baseSegment = `posts/platform/${encodeURIComponent(platform.id)}`;
  const compactHref = routeUrl(manifest, language, `${baseSegment}${options.oldest ? '/oldest' : ''}/`);
  const fullHref = routeUrl(manifest, language, `${baseSegment}/full${options.oldest ? '/oldest' : ''}/`);
  const noBanner = platformBannerKnownAbsent(platform);
  return `<section class="platform-hero platform-hero--${escapeAttribute(platform.id)}${noBanner ? ' platform-hero--no-banner' : ''}">
    <div class="platform-hero-banner">${renderPlatformBannerImages(banner)}</div>
    <div class="platform-hero-profile">
      <div class="platform-hero-icon">${avatar ? `<img src="${escapeAttribute(avatar)}" alt="">` : `<span>${escapeHtml(label.slice(0, 1))}</span>`}${avatar && icon && avatar !== icon ? `<span class="platform-hero-platform-icon"><img src="${escapeAttribute(icon)}" alt=""></span>` : ''}</div>
      <div class="platform-hero-copy">
        <h1 class="platform-hero-title">${escapeHtml(label)}</h1>
        ${account ? `<span>${escapeHtml(platform.id === 'twitter' ? `@${account}` : account)}</span>` : ''}
        ${bio ? `<p class="platform-hero-bio">${linkify(bio).replaceAll('\n', '<br>')}</p>` : ''}
        ${sourceUrl ? `<a class="platform-source-link" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(localeText(manifest.locales, language, 'posts.officialPage'))}${externalLinkIcon()}</a>` : ''}
      </div>
      <nav class="platform-view-tabs" aria-label="${escapeAttribute(localeText(manifest.locales, language, 'posts.view'))}">
        <a class="${options.compact ? 'active' : ''}" href="${escapeAttribute(compactHref)}">${escapeHtml(localeText(manifest.locales, language, 'posts.compactView'))}</a>
        <a class="${options.compact ? '' : 'active'}" href="${escapeAttribute(fullHref)}">${escapeHtml(localeText(manifest.locales, language, 'posts.fullView'))}</a>
      </nav>
    </div>
  </section>`;
}

function renderToolbar(manifest, language, options) {
  const feedLabel = localeText(manifest.locales, language, 'common.feed');
  const pagesLabel = localeText(manifest.locales, language, 'common.pages');
  const tabs = options.tabs ?? [];
  const hasTabs = tabs.length > 0;
  const hasActions = Boolean(options.sortHref) || options.enableFeed !== false;
  if (!hasTabs && !hasActions) return '';
  return `<div class="listing-toolbar">
    ${hasTabs ? `<nav class="tab-list" aria-label="View">
      ${tabs.map((tab) => `<a class="${tab.active ? 'active' : ''}" href="${escapeAttribute(tab.href)}">${escapeHtml(tab.label)}</a>`).join('')}
    </nav>` : '<span></span>'}
    <div class="listing-actions">
      ${options.sortHref ? `<a href="${escapeAttribute(options.sortHref)}">${escapeHtml(options.sortLabel)}</a>` : ''}
      ${options.enableFeed === false ? '' : `<button type="button" data-feed-toggle data-feed-label="${escapeAttribute(feedLabel)}" data-pages-label="${escapeAttribute(pagesLabel)}">${escapeHtml(feedLabel)}</button>`}
    </div>
  </div>`;
}

function renderPagination(manifest, language, baseRelative, page, pageCount) {
  if (pageCount <= 1) return '';
  const pageWindow = 2;
  const previous = page > 1 ? routeUrl(manifest, language, `${pageRelative(baseRelative, page - 1)}/`) : null;
  const next = page < pageCount ? routeUrl(manifest, language, `${pageRelative(baseRelative, page + 1)}/`) : null;
  const pages = [];
  for (let number = 1; number <= pageCount; number += 1) {
    if (number !== 1 && number !== pageCount && Math.abs(number - page) > pageWindow) continue;

    if (number === pageCount && page + pageWindow < pageCount - 1) pages.push(`<span>•</span>`);
    pages.push(`<a class="${number === page ? 'active' : ''}" href="${escapeAttribute(routeUrl(manifest, language, `${pageRelative(baseRelative, number)}/`))}">${number}</a>`);
    if (number === 1 && page - pageWindow > 2) pages.push(`<span>•</span>`);
  }
  return `<nav class="pagination" data-pagination aria-label="Pagination">
    ${previous ? `<a rel="prev" href="${escapeAttribute(previous)}">${escapeHtml(localeText(manifest.locales, language, 'common.previous'))}</a>` : '<span></span>'}
    <span class="pagination-pages">${pages.join('')}</span>
    ${next ? `<a rel="next" href="${escapeAttribute(next)}">${escapeHtml(localeText(manifest.locales, language, 'common.next'))}</a>` : '<span></span>'}
  </nav><div data-feed-sentinel></div>`;
}

function layout(manifest, language, relative, options) {
  const title = options.title;
  const description = options.description ?? localizedValue(manifest.site.description, language, manifest.defaultLanguage) ?? '';
  const canonical = absoluteUrl(manifest, routeUrl(manifest, language, relative));
  const configuredImage = manifest.site.imagePreview && manifest.files[manifest.site.imagePreview]
    ? manifest.site.imagePreview
    : null;
  const fallbackImage = Object.values(manifest.media).map((media) => media.displayFile).find(Boolean) ?? null;
  const imagePath = options.image ?? configuredImage ?? fallbackImage;
  const image = imagePath ? absoluteUrl(manifest, mediaUrl(manifest, imagePath)) : null;
  const languageNav = languageLinks(manifest, relative);
  return `<!doctype html>
<html lang="${escapeAttribute(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttribute(description)}">
  ${options.noindex ? '<meta name="robots" content="noindex,follow">' : ''}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeAttribute(title)}">
  <meta property="og:description" content="${escapeAttribute(description)}">
  <meta property="og:url" content="${escapeAttribute(canonical)}">
  ${image ? `<meta property="og:image" content="${escapeAttribute(image)}">
  <meta name="twitter:card" content="summary_large_image">` : ''}
  <link rel="canonical" href="${escapeAttribute(canonical)}">
  ${languageNav.map((item) => `<link rel="alternate" hreflang="${escapeAttribute(item.language)}" href="${escapeAttribute(item.href)}">`).join('\n  ')}
  <link rel="alternate" hreflang="x-default" href="${escapeAttribute(absoluteUrl(manifest, routeUrl(manifest, manifest.defaultLanguage, relative)))}">
  <link rel="stylesheet" href="${escapeAttribute(joinUrl(manifest.site.basePath, 'assets/archive.css'))}">
</head>
<body${options.bodyClass ? ` class="${escapeAttribute(options.bodyClass)}"` : ''}>
  <header class="site-header">
    <a class="site-title" href="${escapeAttribute(routeUrl(manifest, language, ''))}">${escapeHtml(localizedValue(manifest.site.title, language, manifest.defaultLanguage) ?? 'stairs2line')}</a>
    <nav class="site-nav">
      <a href="${escapeAttribute(routeUrl(manifest, language, 'gallery/'))}">${escapeHtml(localeText(manifest.locales, language, 'nav.gallery'))}</a>
      <a href="${escapeAttribute(routeUrl(manifest, language, 'posts/by-platform/'))}">${escapeHtml(localeText(manifest.locales, language, 'nav.socials'))}</a>
      <a href="${escapeAttribute(routeUrl(manifest, language, 'artworks/'))}">${escapeHtml(localeText(manifest.locales, language, 'nav.revisions'))}</a>
    </nav>
    <nav class="language-nav">${languageNav.map((item) => `<a class="${item.language === language ? 'active' : ''}" href="${escapeAttribute(item.href)}">${escapeHtml(item.language.toUpperCase())}</a>`).join('')}</nav>
  </header>
  <main>
    ${options.body}
  </main>
  <script src="${escapeAttribute(joinUrl(manifest.site.basePath, 'assets/feed.js'))}" defer></script>
  <script src="${escapeAttribute(joinUrl(manifest.site.basePath, 'assets/media-viewer-adapter.js'))}" defer></script>
</body>
</html>`;
}

async function writePage(outputRoot, manifest, language, relative, html) {
  const filePath = outputFile(outputRoot, language, relative);
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, html, 'utf8');
}

async function writeRedirectPage(outputRoot, manifest, language, relative, targetRelative) {
  const target = routeUrl(manifest, language, targetRelative);
  await writePage(outputRoot, manifest, language, relative, `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,follow"><meta http-equiv="refresh" content="0; url=${escapeAttribute(target)}"><link rel="canonical" href="${escapeAttribute(target)}">`);
}

async function writePaginatedListing(outputRoot, manifest, language, baseRelative, items, pageSize, renderItem, pageOptions) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  for (let page = 1; page <= pageCount; page += 1) {
    const pageItems = items.slice((page - 1) * pageSize, page * pageSize);
    const relative = pageRelative(baseRelative, page);
    const itemContext = { page, pageCount, pageItems };
    const beforeItems = typeof pageOptions.beforeItems === 'function'
      ? pageOptions.beforeItems(itemContext)
      : (pageOptions.beforeItems ?? '');
    const afterItems = typeof pageOptions.afterItems === 'function'
      ? pageOptions.afterItems(itemContext)
      : (pageOptions.afterItems ?? '');
    const body = `${pageOptions.beforeHeading ?? ''}${pageOptions.heading ? `<h1>${escapeHtml(pageOptions.heading)}</h1>` : ''}
      ${renderToolbar(manifest, language, { ...pageOptions.toolbar, enableFeed: pageCount > 1 })}
      <section class="${escapeAttribute(pageOptions.listClass)}" data-paged-list>
        ${beforeItems}
        ${pageItems.length > 0 ? pageItems.map((item, index) => renderItem(item, index, itemContext)).join('\n') : `<p>${escapeHtml(localeText(manifest.locales, language, 'common.noItems'))}</p>`}
        ${afterItems}
      </section>
      ${renderPagination(manifest, language, baseRelative, page, pageCount)}`;
    const pageTitle = page === 1 ? pageOptions.title : `${pageOptions.title} · ${localeText(manifest.locales, language, 'common.page', { page })}`;
    await writePage(outputRoot, manifest, language, relative, layout(manifest, language, `${relative}/`, {
      title: pageTitle,
      description: pageOptions.description,
      noindex: pageOptions.noindex,
      bodyClass: pageOptions.bodyClass,
      body
    }));
  }
}

function galleryTabs(manifest, language, activeKey, oldest) {
  const prefix = (key) => {
    const segment = key === 'popular' ? 'gallery' : `gallery/${key}`;
    return oldest ? `${segment}/oldest/` : `${segment}/`;
  };
  return Object.keys(SCOPE_FILTERS).map((key) => ({
    active: key === activeKey,
    href: routeUrl(manifest, language, prefix(key)),
    label: localeText(manifest.locales, language, `artworks.${key}`)
  }));
}

function chooseRepresentativeVersion(artwork, scopes) {
  return artwork.versions.find((version) => scopes.includes(version.scope) && version.mediaIds.length > 0) ?? null;
}

async function buildArtworkListings(outputRoot, manifest, language) {
  const revisionCandidates = manifest.artworks
    .map((artwork) => ({ artwork, versions: nonDecorativeRevisionVersions(manifest, artwork) }))
    .filter((item) => item.versions.length > 0);
  for (const direction of ['desc', 'asc']) {
    const shortestFirst = direction === 'asc';
    const baseRelative = shortestFirst ? 'artworks/oldest' : 'artworks';
    const sortCandidates = (items) => [...items].sort((a, b) => {
      const aInterval = revisionIntervalMs(a.artwork, a.versions);
      const bInterval = revisionIntervalMs(b.artwork, b.versions);
      if (aInterval !== null || bInterval !== null) {
        if (aInterval === null) return 1;
        if (bInterval === null) return -1;
        if (aInterval !== bInterval) return shortestFirst ? aInterval - bInterval : bInterval - aInterval;
      }

      // Equal/unknown intervals remain stable and useful by falling back to the
      // relevant endpoint date. Single-image cards therefore still have a
      // deterministic order inside their separate section.
      const aBounds = revisionDateBounds(a.artwork, a.versions);
      const bBounds = revisionDateBounds(b.artwork, b.versions);
      const aDate = shortestFirst ? aBounds.earliest?.sortAt : aBounds.latest?.sortAt;
      const bDate = shortestFirst ? bBounds.earliest?.sortAt : bBounds.latest?.sortAt;
      return compareNullableDates(aDate, bDate, direction) || a.artwork.id.localeCompare(b.artwork.id);
    });
    const multiVersion = sortCandidates(revisionCandidates.filter((item) => item.versions.length > 1))
      .map((item) => ({ ...item, isSingle: false }));
    const singleVersion = sortCandidates(revisionCandidates.filter((item) => item.versions.length === 1))
      .map((item) => ({ ...item, isSingle: true }));
    const sorted = [...multiVersion, ...singleVersion];
    await writePaginatedListing(
      outputRoot,
      manifest,
      language,
      baseRelative,
      sorted,
      manifest.site.pageSize?.artworks ?? 36,
      (item, index, context) => {
        const previous = context?.pageItems?.[index - 1] ?? null;
        const singleHeading = item.isSingle && (index === 0 || !previous?.isSingle)
          ? `<h2 class="revision-section-heading" data-feed-dedupe-key="revision-single-heading">${escapeHtml(localeText(manifest.locales, language, 'artworks.singleImagesTitle'))}</h2>`
          : '';
        return `${singleHeading}${renderRevisionCard(manifest, item.artwork, language, item.versions)}`;
      },
      {
        heading: localeText(manifest.locales, language, 'artworks.revisionsTitle'),
        title: `${localeText(manifest.locales, language, 'artworks.revisionsTitle')} · stairs2line`,
        description: localeText(manifest.locales, language, 'artworks.revisionsDescription'),
        listClass: 'card-grid revision-grid',
        bodyClass: 'revisions-page',
        noindex: shortestFirst,
        toolbar: {
          sortHref: routeUrl(manifest, language, shortestFirst ? 'artworks/' : 'artworks/oldest/'),
          sortLabel: localeText(manifest.locales, language, shortestFirst ? 'artworks.longestInterval' : 'artworks.shortestInterval')
        }
      }
    );
  }

  // The old filtered artwork URLs used the same data model as the gallery.
  // Keep them as compatibility redirects instead of silently changing meaning.
  for (const key of ['major', 'versions', 'all']) {
    await writeRedirectPage(outputRoot, manifest, language, `artworks/${key}`, `gallery/${key}/`);
    await writeRedirectPage(outputRoot, manifest, language, `artworks/${key}/oldest`, `gallery/${key}/oldest/`);
  }
}

async function buildGalleryListings(outputRoot, manifest, language) {
  for (const [filterKey, scopes] of Object.entries(SCOPE_FILTERS)) {
    for (const direction of ['desc', 'asc']) {
      const oldest = direction === 'asc';
      const baseSegment = filterKey === 'popular' ? 'gallery' : `gallery/${filterKey}`;
      const baseRelative = oldest ? `${baseSegment}/oldest` : baseSegment;
      const versions = manifest.artworks.flatMap((artwork) => {
        const hasNonDecorativeVersion = artwork.versions.some((version) => version.scope !== 'decorative');
        if (!hasNonDecorativeVersion) return [];
        return artwork.versions
          .filter((version) => scopes.includes(version.scope) && revisionPreviewMedia(manifest, version)?.displayFile)
          .map((version) => ({ artwork, version }));
      })
        .sort((a, b) => compareNullableDates(a.version.sortAt, b.version.sortAt, direction) || a.version.key.localeCompare(b.version.key));
      const firstUndatedIndex = versions.findIndex((item) => !item.version.sortAt);
      const galleryItems = versions.map((item, index) => ({
        ...item,
        startsUndatedGroup: firstUndatedIndex > 0 && index === firstUndatedIndex
      }));
      await writePaginatedListing(
        outputRoot,
        manifest,
        language,
        baseRelative,
        galleryItems,
        manifest.site.pageSize?.versions ?? 48,
        (item, index) => renderGalleryItem(manifest, item.artwork, item.version, language, index, {
          startsUndatedGroup: item.startsUndatedGroup
        }),
        {
          heading: null,
          title: `${localeText(manifest.locales, language, 'gallery.pageTitle')} · stairs2line`,
          description: localeText(manifest.locales, language, 'gallery.description'),
          listClass: 'gallery-grid',
          bodyClass: 'gallery-page',
          noindex: oldest,
          toolbar: {
            tabs: galleryTabs(manifest, language, filterKey, oldest),
            sortHref: routeUrl(manifest, language, oldest ? `${baseSegment}/` : `${baseSegment}/oldest/`),
            sortLabel: localeText(manifest.locales, language, oldest ? 'common.oldest' : 'common.newest')
          }
        }
      );
    }
  }
}

function artworkDateText(manifest, version, language) {
  const date = version.sortAt ? formatDate(version.sortAt, language, { includeTime: false }) : null;
  if (!date) return localeText(manifest.locales, language, 'common.unknownDate');
  const key = version.dateSource === 'createdAt'
    ? 'artworks.created'
    : version.dateSource === 'knownNotAfter'
      ? 'artworks.knownNotAfter'
      : 'artworks.firstPost';
  return localeText(manifest.locales, language, key, { date });
}

async function buildArtworkPages(outputRoot, manifest, language) {
  const postsById = new Map(manifest.posts.map((post) => [post.key, post]));
  for (const artwork of manifest.artworks) {
    const title = displayTitle(artwork, language, manifest.defaultLanguage);
    const description = displayDescription(artwork, language, manifest.defaultLanguage)
      ?? localeText(manifest.locales, language, 'artworks.genericDescription', {
        versions: artwork.versions.length,
        media: artwork.versions.reduce((sum, version) => sum + version.mediaIds.length, 0)
      });
    const versionHtml = artwork.versions.map((version) => {
      const mediaHtml = version.mediaIds.map((mediaId) => {
        const media = manifest.media[mediaId];
        const linkedPosts = (media?.postIds ?? []).map((postId) => postsById.get(postId)).filter(Boolean);
        return `<article class="artwork-media" data-list-item id="${escapeAttribute(version.id)}">
          ${mediaElement(manifest, media, language, title, 'artworkVersion', version.key, { viewerAlignGroup: artwork.id })}
          <!--${media ? renderPlatformLinks(manifest, media, language) : ''}
          <details>
            <summary>${escapeHtml(localeText(manifest.locales, language, 'common.files'))}: ${media?.existingFiles.length ?? 0}</summary>
            <ul>${(media?.existingFiles ?? []).map((filePath) => `<li><a href="${escapeAttribute(mediaUrl(manifest, filePath))}">${escapeHtml(filePath)}</a> (${manifest.files[filePath]?.byteLength ?? 0} B)</li>`).join('')}</ul>
          </details>-->
          <ul class="artwork-posts">
            ${linkedPosts.length > 0
              ? linkedPosts.map((post) => `<li><a href="${escapeAttribute(routeUrl(manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}/`))}"><div class="platform-link"><img src="${platformIconUrl(manifest, manifest.platforms.find((item) => item.id === post.platform))}" alt=""></div>${displayPostDate(manifest, post, language, { includeTime: true })}</a></li>`).join('')
              : `<li class="artwork-posts-empty">${escapeHtml(localeText(manifest.locales, language, 'artworks.noKnownPosts'))}</li>`}
          </ul>
        </article>`;
      }).join('');
      return mediaHtml;
    }).join('');

    const body = `<article class="artwork-page">
      <h1>${escapeHtml(localeText(manifest.locales, language, 'artworks.artworkVersions'))}</h1>
      <div class="card-grid" data-paged-list>${versionHtml}</div>
    </article>`;
    const artworkImage = artwork.versions
      .flatMap((version) => version.mediaIds)
      .map((mediaId) => manifest.media[mediaId]?.displayFile)
      .find(Boolean);
    await writePage(outputRoot, manifest, language, `artworks/${artwork.slug}`, layout(manifest, language, `artworks/${artwork.slug}/`, {
      title: `${title} · stairs2line`,
      description: stripLinks(description),
      image: artworkImage,
      body
    }));
  }
}

async function buildPostListings(outputRoot, manifest, language) {
  for (const platform of manifest.platforms) {
    const platformPosts = manifest.posts.filter((post) => post.platform === platform.id);
    if (platformPosts.length === 0) continue;
    for (const direction of ['desc', 'asc']) {
      const oldest = direction === 'asc';
      const baseSegment = `posts/platform/${encodeURIComponent(platform.id)}`;
      const sorted = [...platformPosts].sort((a, b) => compareNullableDates(a.publishedAt, b.publishedAt, direction) || a.key.localeCompare(b.key));
      const label = platformLabel(platform, language, manifest.defaultLanguage);

      // Compact archives are the canonical/default platform view.
      const compactRelative = oldest ? `${baseSegment}/oldest` : baseSegment;
      const compactSortHref = routeUrl(manifest, language, oldest ? `${baseSegment}/` : `${baseSegment}/oldest/`);
      const compactBody = `${renderPlatformHero(manifest, platform, language, { oldest, compact: true })}
        ${renderToolbar(manifest, language, {
          sortHref: compactSortHref,
          sortLabel: localeText(manifest.locales, language, oldest ? 'common.oldest' : 'common.newest'),
          enableFeed: false
        })}
        ${renderCompactListing(manifest, sorted, language, platform)}`;
      await writePage(outputRoot, manifest, language, compactRelative, layout(manifest, language, `${compactRelative}/`, {
        title: `${label} · ${localeText(manifest.locales, language, 'posts.compactView')}`,
        description: localeText(manifest.locales, language, 'posts.genericDescription', { platform: label }),
        noindex: oldest,
        bodyClass: `platform-page platform-page--${platform.id} compact-platform-page`,
        body: compactBody
      }));

      // Preserve the old /compact route as a noindex compatibility alias.
      const legacyCompactRelative = `${baseSegment}/compact${oldest ? '/oldest' : ''}`;
      await writePage(outputRoot, manifest, language, legacyCompactRelative, layout(manifest, language, `${legacyCompactRelative}/`, {
        title: `${label} · ${localeText(manifest.locales, language, 'posts.compactView')}`,
        description: localeText(manifest.locales, language, 'posts.genericDescription', { platform: label }),
        noindex: true,
        bodyClass: `platform-page platform-page--${platform.id} compact-platform-page`,
        body: compactBody
      }));

      const fullRelative = `${baseSegment}/full${oldest ? '/oldest' : ''}`;
      await writePaginatedListing(
        outputRoot,
        manifest,
        language,
        fullRelative,
        sorted,
        manifest.site.pageSize?.posts ?? 20,
        (post, index) => renderPostCard(manifest, post, language, index, { hidePlatform: true }),
        {
          heading: null,
          title: `${label} · ${localeText(manifest.locales, language, 'posts.fullView')}`,
          description: localeText(manifest.locales, language, 'posts.genericDescription', { platform: label }),
          listClass: 'post-list',
          beforeHeading: renderPlatformHero(manifest, platform, language, { oldest, compact: false }),
          bodyClass: `platform-page platform-page--${platform.id} full-platform-page`,
          noindex: oldest,
          toolbar: {
            sortHref: routeUrl(manifest, language, oldest ? `${baseSegment}/full/` : `${baseSegment}/full/oldest/`),
            sortLabel: localeText(manifest.locales, language, oldest ? 'common.oldest' : 'common.newest')
          },
          beforeItems: oldest
            ? ({ page }) => page === 1 ? renderPlatformCreatedEvent(manifest, platform, language) : ''
            : '',
          afterItems: !oldest
            ? ({ page, pageCount }) => page === pageCount ? renderPlatformCreatedEvent(manifest, platform, language) : ''
            : ''
        }
      );
    }
  }
}

function renderPlatformPreviewPost(manifest, post, language) {
  const version = latestPostVersion(post);
  const mediaRef = version.mediaRefs?.[0] ?? null;
  const platform = manifest.platforms.find((item) => item.id === post.platform);
  const title = displayTitle(version, language, version.originalLanguage)
    ?? displayDescription(version, language, version.originalLanguage)
    ?? fallbackPostTitle(manifest, post, platform, language);
  const date = displayPostDate(manifest, post, language, { includeTime: false });
  const href = routeUrl(manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}/`);
  const lostBadge = isRecoveredMediaOnly(post) ? `<span class="platform-preview-lost">${escapeHtml(localeText(manifest.locales, language, 'common.lost'))}</span>` : '';
  return `<a class="platform-preview-post${isRecoveredMediaOnly(post) ? ' platform-preview-post--lost' : ''}" href="${escapeAttribute(href)}" title="${escapeAttribute(`${date} · ${title}`)}">${compactMediaElement(manifest, mediaRef, title)}${lostBadge}</a>`;
}

async function buildPlatformIndex(outputRoot, manifest, language) {
  const cards = manifest.platforms.map((platform) => {
    const posts = manifest.posts.filter((post) => post.platform === platform.id);
    if (posts.length === 0) return '';
    const label = platformLabel(platform, language, manifest.defaultLanguage);
    const icon = platformIconUrl(manifest, platform);
    const avatar = platformAvatarUrl(manifest, platform);
    const banner = platformBannerUrl(manifest, platform);
    const profile = currentPlatformVersion(platform);
    const account = profile.account ?? platform.defaultAccount ?? '';
    const bio = localizedValue(profile.description, language, manifest.defaultLanguage);
    const sourceUrl = platformSourceUrl(platform);
    const dated = posts.filter((post) => post.publishedAt).sort((a, b) => compareNullableDates(a.publishedAt, b.publishedAt, 'asc'));
    const first = dated[0]?.publishedAt ? formatDate(dated[0].publishedAt, language, { includeTime: false }) : null;
    const last = dated.at(-1)?.publishedAt ? formatDate(dated.at(-1).publishedAt, language, { includeTime: false }) : null;
    const previewPosts = [...posts].sort((a, b) => compareNullableDates(a.publishedAt, b.publishedAt, 'desc')).slice(0, 6);
    const href = routeUrl(manifest, language, `posts/platform/${encodeURIComponent(platform.id)}/`);
    const noBanner = platformBannerKnownAbsent(platform);
    return `<article class="platform-card platform-card--${escapeAttribute(platform.id)}${noBanner ? ' platform-card--no-banner' : ''}" data-list-item>
      <a class="platform-card-hit-area" href="${escapeAttribute(href)}" aria-label="${escapeAttribute(label)}"></a>
      <div class="platform-card-banner">${renderPlatformBannerImages(banner)}</div>
      <div class="platform-card-profile">
        <div class="platform-card-avatar">${avatar ? `<img src="${escapeAttribute(avatar)}" alt="">` : `<span>${escapeHtml(label.slice(0, 1))}</span>`}${avatar && icon && avatar !== icon ? `<span class="platform-card-platform-icon"><img src="${escapeAttribute(icon)}" alt=""></span>` : ''}</div>
        <div class="platform-card-copy">
          <h2>${escapeHtml(label)}</h2>
          ${account ? `<span class="metadata">${escapeHtml(platform.id === 'twitter' ? `@${account}` : account)}</span>` : ''}
        </div>
        <div class="platform-card-count"><strong>${posts.length}</strong><span>${escapeHtml(localeText(manifest.locales, language, 'common.posts').toLowerCase())}</span></div>
      </div>
      ${bio ? `<p class="platform-card-bio">${linkify(bio).replaceAll('\n', '<br>')}</p>` : ''}
      ${sourceUrl ? `<p class="platform-card-source"><a class="platform-source-link" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(localeText(manifest.locales, language, 'posts.officialPage'))}${externalLinkIcon()}</a></p>` : ''}
      ${first || last ? `<p class="metadata platform-card-dates">${escapeHtml(first ?? '—')} — ${escapeHtml(last ?? '—')}</p>` : ''}
      <div class="platform-preview">${previewPosts.map((post) => renderPlatformPreviewPost(manifest, post, language)).join('')}</div>
    </article>`;
  }).join('');
  const body = `<h1>${escapeHtml(localeText(manifest.locales, language, 'posts.socialsTitle'))}</h1>
    <section class="platform-list" data-paged-list>${cards}</section>`;
  await writePage(outputRoot, manifest, language, 'posts/by-platform', layout(manifest, language, 'posts/by-platform/', {
    title: `${localeText(manifest.locales, language, 'posts.socialsTitle')} · stairs2line`,
    description: localizedValue(manifest.site.description, language, manifest.defaultLanguage),
    bodyClass: 'platform-index-page',
    body
  }));
}

async function buildPostPages(outputRoot, manifest, language) {
  for (const post of manifest.posts) {
    const platform = manifest.platforms.find((item) => item.id === post.platform);
    const label = platformLabel(platform, language, manifest.defaultLanguage);
    const currentVersion = latestPostVersion(post);
    const title = displayTitle(currentVersion, language, currentVersion.originalLanguage)
      ?? fallbackPostTitle(manifest, post, platform, language);
    const description = displayDescription(currentVersion, language, currentVersion.originalLanguage)
      ?? (isRecoveredMediaOnly(post)
        ? localeText(manifest.locales, language, 'posts.lostMediaOnly')
        : localeText(manifest.locales, language, 'posts.genericDescription', { platform: label }));
    const versions = post.versions?.length ? post.versions : [currentVersion];
    const versionCards = versions.map((version, index) => renderPostCard(manifest, post, language, index, {
      version,
      versionLabel: versions.length > 1
        ? localeText(manifest.locales, language, 'posts.versionLabel', { current: index + 1, total: versions.length })
        : null,
      showVersionEvidence: true
    })).join('');
    const body = `${renderPlatformHero(manifest, platform, language, { compact: false, oldest: false })}
      <article class="post-page"><div class="post-version-list">${versionCards}</div></article>`;
    const postImage = currentVersion.mediaRefs?.map((item) => item.displayFile).find(Boolean)
      ?? post.mediaIds.map((mediaId) => manifest.media[mediaId]?.displayFile).find(Boolean);
    await writePage(outputRoot, manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}`, layout(manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}/`, {
      title: `${title} · stairs2line`,
      description: stripLinks(description),
      image: postImage,
      bodyClass: `platform-page platform-page--${post.platform} post-detail-page`,
      body
    }));
  }
}

async function writePlaceholders(outputRoot, manifest) {
  for (const file of Object.values(manifest.files)) {
    if (!file.placeholder) continue;
    const media = Object.values(manifest.media).find((item) => item.displayFile === file.path);
    const label = media?.legacyIds?.join(', ') || media?.id || 'Missing media';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="960" viewBox="0 0 960 960">
  <rect width="960" height="960" fill="#ececec"/>
  <path d="M160 700 360 470l130 135 115-120 195 215Z" fill="#c4c4c4"/>
  <circle cx="680" cy="285" r="75" fill="#c4c4c4"/>
  <text x="480" y="820" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#444">${escapeHtml(label.slice(0, 90))}</text>
</svg>`;
    const destination = path.join(outputRoot, file.path);
    await ensureDirectory(path.dirname(destination));
    await fs.writeFile(destination, svg, 'utf8');
  }
}

function adminArtworkSourceFiles(source) {
  return Object.fromEntries((source.artworks ?? []).map((artwork) => {
    const sourceFile = artwork.__source;
    if (!sourceFile) return [artwork.id, null];

    if (source.sourceRoot) {
      const relative = path.relative(source.sourceRoot, sourceFile).replaceAll('\\', '/');
      if (relative && !relative.startsWith('../') && relative !== '..') return [artwork.id, relative];
    }

    const normalized = String(sourceFile).replaceAll('\\', '/');
    const marker = '/artworks/';
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex >= 0) return [artwork.id, `artworks/${normalized.slice(markerIndex + marker.length)}`];
    return [artwork.id, `artworks/${path.basename(sourceFile)}`];
  }));
}

function buildViewerIndex(manifest) {
  return {
    viewerStrings: Object.fromEntries(Object.keys(manifest.locales ?? {}).map((language) => [language, {
      noKnownPosts: localeText(manifest.locales, language, 'artworks.noKnownPosts'),
      originalPost: localeText(manifest.locales, language, 'posts.originalPost')
    }])),
    platforms: Object.fromEntries(manifest.platforms.map((platform) => [platform.id, {
      id: platform.id,
      label: platform.label
    }])),
    media: Object.fromEntries(Object.values(manifest.media).map((media) => [media.id, {
      displayFile: media.displayFile,
      files: media.existingFiles,
      postIds: media.postIds,
      artworkId: media.artworkId,
      versionId: media.versionId,
      viewerAnchor: media.viewerAnchor ?? null
    }])),
    posts: Object.fromEntries(manifest.posts.map((post) => [post.key, {
      key: post.key,
      id: post.id,
      platform: post.platform,
      status: post.status,
      publishedAt: post.publishedAt,
      dateApproximate: post.dateApproximate ?? false,
      recovery: post.recovery ?? null,
      title: post.title,
      description: post.description,
      href: post.href,
      mediaFiles: post.mediaFiles,
      versions: post.versions.map((version) => ({
        index: version.index,
        status: version.status,
        firstRebloggedAt: version.firstRebloggedAt ?? null,
        reblogs: version.reblogs ?? [],
        title: version.title,
        description: version.description,
        href: version.href,
        mediaFiles: version.mediaFiles,
        layout: version.layout,
        recovery: version.recovery ?? null
      }))
    }])),
    artworks: Object.fromEntries(manifest.artworks.map((artwork) => [artwork.id, {
      id: artwork.id,
      slug: artwork.slug,
      title: artwork.title,
      description: artwork.description
    }]))
  };
}

async function collectIndexPages(directory, root = directory) {
  const result = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const itemPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectIndexPages(itemPath, root));
    else if (entry.isFile() && entry.name === 'index.html') result.push(path.relative(root, itemPath).replaceAll('\\', '/'));
  }
  return result;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function writeSitemaps(outputRoot, manifest) {
  if (!manifest.site.origin) return;
  const indexFiles = await collectIndexPages(outputRoot);
  const pageUrls = indexFiles
    .filter((filePath) => filePath !== 'admin/index.html' && !filePath.includes('/oldest/'))
    .map((filePath) => {
      const directory = filePath === 'index.html' ? '' : filePath.slice(0, -'index.html'.length);
      return absoluteUrl(manifest, joinUrl(manifest.site.basePath, directory));
    });
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pageUrls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join('\n')}
</urlset>
`;
  await fs.writeFile(path.join(outputRoot, 'sitemap.xml'), sitemap, 'utf8');

  const language = manifest.defaultLanguage;
  const imageEntries = manifest.artworks.map((artwork) => {
    const pageUrl = absoluteUrl(manifest, routeUrl(manifest, language, `artworks/${artwork.slug}/`));
    const imageUrls = artwork.versions
      .flatMap((version) => version.mediaIds)
      .map((mediaId) => manifest.media[mediaId]?.displayFile)
      .filter(Boolean)
      .map((filePath) => absoluteUrl(manifest, mediaUrl(manifest, filePath)));
    return `  <url>
    <loc>${xmlEscape(pageUrl)}</loc>
${imageUrls.map((url) => `    <image:image><image:loc>${xmlEscape(url)}</image:loc></image:image>`).join('\n')}
  </url>`;
  }).join('\n');
  const imageSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${imageEntries}
</urlset>
`;
  await fs.writeFile(path.join(outputRoot, 'image-sitemap.xml'), imageSitemap, 'utf8');
  await fs.writeFile(path.join(outputRoot, 'robots.txt'), `Sitemap: ${absoluteUrl(manifest, joinUrl(manifest.site.basePath, 'sitemap.xml'))}
Sitemap: ${absoluteUrl(manifest, joinUrl(manifest.site.basePath, 'image-sitemap.xml'))}
`, 'utf8');
}

export async function buildStaticSite(compilation, source, outputRoot, options = {}) {
  const manifest = { ...compilation.manifest, locales: source.locales };
  await fs.rm(outputRoot, { recursive: true, force: true });
  await ensureDirectory(outputRoot);

  const siteAssets = fileURLToPath(new URL('../site/', import.meta.url));
  await copyDirectory(siteAssets, path.join(outputRoot, 'assets'));
  const adminAssets = fileURLToPath(new URL('../admin/', import.meta.url));
  await copyDirectory(adminAssets, path.join(outputRoot, 'admin'));

  await ensureDirectory(path.join(outputRoot, 'data'));
  await fs.writeFile(path.join(outputRoot, 'data', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputRoot, 'data', 'validation.json'), `${JSON.stringify({ summary: manifest.summary, issues: compilation.issues }, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputRoot, 'data', 'viewer-index.json'), `${JSON.stringify(buildViewerIndex(manifest), null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputRoot, 'data', 'admin-data.json'), `${JSON.stringify({
    site: manifest.site,
    platforms: manifest.platforms,
    artworks: manifest.artworks,
    artworkSourceFiles: adminArtworkSourceFiles(source),
    posts: manifest.posts,
    media: manifest.media,
    files: manifest.files,
    issues: compilation.issues
  }, null, 2)}\n`, 'utf8');

  await writePlaceholders(outputRoot, manifest);

  if (options.copyMedia && options.mediaRoot) {
    const mediaDestination = path.join(outputRoot, String(manifest.site.mediaBasePath ?? 'media/stairs2line/').replace(/^\/+|\/+$/g, ''));
    await copyDirectory(options.mediaRoot, mediaDestination);
  }

  for (const language of manifest.languages) {
    await buildHomePage(outputRoot, manifest, language);
    await buildGalleryListings(outputRoot, manifest, language);
    await buildArtworkListings(outputRoot, manifest, language);
    await buildArtworkPages(outputRoot, manifest, language);
    await buildPostListings(outputRoot, manifest, language);
    await buildPlatformIndex(outputRoot, manifest, language);
    await buildPostPages(outputRoot, manifest, language);
    await writeRedirectPage(outputRoot, manifest, language, 'posts', '');
    await writeRedirectPage(outputRoot, manifest, language, 'posts/oldest', '');
  }

  const rootRedirect = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${escapeAttribute(routeUrl(manifest, manifest.defaultLanguage, ''))}"><link rel="canonical" href="${escapeAttribute(routeUrl(manifest, manifest.defaultLanguage, ''))}">`;
  await fs.writeFile(path.join(outputRoot, 'index.html'), rootRedirect, 'utf8');
  await writeSitemaps(outputRoot, manifest);

  return manifest;
}
