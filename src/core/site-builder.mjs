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
  return localizedValue(entity.title, language, fallbackLanguage) ?? entity.id ?? entity.key;
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
    `data-context-id="${escapeAttribute(contextId)}"`
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
    if (!post || !platform || !post.href) continue;
    const icon = platformIconUrl(manifest, platform);
    const label = platformLabel(platform, language, manifest.defaultLanguage);
    links.push(`<a class="platform-link ${post.status === 'deleted' ? 'is-deleted' : ''}" href="${escapeAttribute(post.href)}" target="_blank" rel="noreferrer" title="${escapeAttribute(label)}">${icon ? `<img src="${escapeAttribute(icon)}" alt="">` : escapeHtml(label)}</a>`);
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
      <h2><a href="${escapeAttribute(href)}">${escapeHtml(title)}</a></h2>
      ${description ? `<p>${escapeHtml(description)}</p>` : ''}
      <p class="metadata">${date ? escapeHtml(date) : escapeHtml(localeText(manifest.locales, language, 'common.unknownDate'))} · ${escapeHtml(version.scope)}</p>
    </div>
  </article>`;
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
      <h2><a href="${escapeAttribute(href)}">${escapeHtml(versionTitle)}</a></h2>
      <p class="metadata">${date ? escapeHtml(date) : escapeHtml(localeText(manifest.locales, language, 'common.unknownDate'))} · ${escapeHtml(version.scope)}</p>
    </div>
  </article>`;
}

function renderPostMedia(manifest, post, language, index) {
  if (post.mediaIds.length === 0) return '';
  const title = localizedValue(post.title, language, post.originalLanguage)
    ?? localizedValue(post.description, language, post.originalLanguage)
    ?? post.key;
  return `<div class="post-media-grid">${post.mediaIds.map((mediaId, mediaIndex) => {
    const media = manifest.media[mediaId];
    return `<div class="post-media-item">${mediaElement(manifest, media, language, title, 'post', post.key, { eager: index === 0 && mediaIndex === 0 })}</div>`;
  }).join('')}</div>`;
}

function renderPostCard(manifest, post, language, index) {
  const platform = manifest.platforms.find((item) => item.id === post.platform);
  const label = platformLabel(platform, language, manifest.defaultLanguage);
  const icon = platformIconUrl(manifest, platform);
  const title = displayTitle(post, language, post.originalLanguage);
  const description = displayDescription(post, language, post.originalLanguage);
  const date = post.publishedAt ? formatDate(post.publishedAt, language) : localeText(manifest.locales, language, 'common.unknownDate');
  const href = routeUrl(manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}/`);
  return `<article class="post-card" data-list-item data-post-id="${escapeAttribute(post.key)}">
    <header class="post-header">
      <a class="post-platform" href="${escapeAttribute(routeUrl(manifest, language, `posts/platform/${encodeURIComponent(post.platform)}/`))}">
        ${icon ? `<img src="${escapeAttribute(icon)}" alt="">` : ''}<span>${escapeHtml(label)}</span>
      </a>
      <a class="post-date" href="${escapeAttribute(href)}"><time${post.publishedAt ? ` datetime="${escapeAttribute(post.publishedAt)}"` : ''}>${escapeHtml(date)}</time></a>
      <span class="status status-${escapeAttribute(post.status)}">${escapeHtml(localeText(manifest.locales, language, `common.${post.status}`))}</span>
    </header>
    <div class="post-body">
      ${title ? `<h2><a href="${escapeAttribute(href)}">${escapeHtml(title)}</a></h2>` : ''}
      ${description ? `<div class="post-text" lang="${escapeAttribute(post.originalLanguage)}">${escapeHtml(description).replaceAll('\n', '<br>')}</div>` : ''}
      ${renderPostMedia(manifest, post, language, index)}
    </div>
    <footer class="post-footer">
      <a href="${escapeAttribute(href)}">${escapeHtml(localeText(manifest.locales, language, 'common.open'))}</a>
      ${post.href ? `<a href="${escapeAttribute(post.href)}" target="_blank" rel="noreferrer">${escapeHtml(localeText(manifest.locales, language, 'common.source'))}</a>` : ''}
    </footer>
  </article>`;
}

function renderToolbar(manifest, language, options) {
  const feedLabel = localeText(manifest.locales, language, 'common.feed');
  const pagesLabel = localeText(manifest.locales, language, 'common.pages');
  return `<div class="listing-toolbar">
    <nav class="tab-list" aria-label="View">
      ${options.tabs.map((tab) => `<a class="${tab.active ? 'active' : ''}" href="${escapeAttribute(tab.href)}">${escapeHtml(tab.label)}</a>`).join('')}
    </nav>
    <div class="listing-actions">
      ${options.sortHref ? `<a href="${escapeAttribute(options.sortHref)}">${escapeHtml(options.sortLabel)}</a>` : ''}
      ${options.enableFeed === false ? '' : `<button type="button" data-feed-toggle data-feed-label="${escapeAttribute(feedLabel)}" data-pages-label="${escapeAttribute(pagesLabel)}">${escapeHtml(feedLabel)}</button>`}
    </div>
  </div>`;
}

function renderPagination(manifest, language, baseRelative, page, pageCount) {
  if (pageCount <= 1) return '';
  const previous = page > 1 ? routeUrl(manifest, language, `${pageRelative(baseRelative, page - 1)}/`) : null;
  const next = page < pageCount ? routeUrl(manifest, language, `${pageRelative(baseRelative, page + 1)}/`) : null;
  const pages = [];
  for (let number = 1; number <= pageCount; number += 1) {
    if (number !== 1 && number !== pageCount && Math.abs(number - page) > 2) continue;
    pages.push(`<a class="${number === page ? 'active' : ''}" href="${escapeAttribute(routeUrl(manifest, language, `${pageRelative(baseRelative, number)}/`))}">${number}</a>`);
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
<body>
  <header class="site-header">
    <a class="site-title" href="${escapeAttribute(routeUrl(manifest, language, 'artworks/'))}">${escapeHtml(localizedValue(manifest.site.title, language, manifest.defaultLanguage) ?? 'stairs2line')}</a>
    <nav class="site-nav">
      <a href="${escapeAttribute(routeUrl(manifest, language, 'artworks/'))}">${escapeHtml(localeText(manifest.locales, language, 'nav.artworks'))}</a>
      <a href="${escapeAttribute(routeUrl(manifest, language, 'posts/'))}">${escapeHtml(localeText(manifest.locales, language, 'nav.posts'))}</a>
      <a href="${escapeAttribute(routeUrl(manifest, language, 'posts/by-platform/'))}">${escapeHtml(localeText(manifest.locales, language, 'nav.platforms'))}</a>
    </nav>
    <nav class="language-nav">${languageNav.map((item) => `<a class="${item.language === language ? 'active' : ''}" href="${escapeAttribute(item.href)}">${escapeHtml(item.language.toUpperCase())}</a>`).join('')}</nav>
  </header>
  <div id="archive-validation-alert" hidden></div>
  <main>
    ${options.body}
  </main>
  <script src="${escapeAttribute(joinUrl(manifest.site.basePath, 'assets/feed.js'))}" defer></script>
  <script src="${escapeAttribute(joinUrl(manifest.site.basePath, 'assets/media-viewer-adapter.js'))}" defer></script>
  <script src="${escapeAttribute(joinUrl(manifest.site.basePath, 'assets/aspnet-validation-alert.js'))}" defer></script>
</body>
</html>`;
}

async function writePage(outputRoot, manifest, language, relative, html) {
  const filePath = outputFile(outputRoot, language, relative);
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, html, 'utf8');
}

async function writePaginatedListing(outputRoot, manifest, language, baseRelative, items, pageSize, renderItem, pageOptions) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  for (let page = 1; page <= pageCount; page += 1) {
    const pageItems = items.slice((page - 1) * pageSize, page * pageSize);
    const relative = pageRelative(baseRelative, page);
    const body = `<h1>${escapeHtml(pageOptions.heading)}</h1>
      ${renderToolbar(manifest, language, { ...pageOptions.toolbar, enableFeed: pageCount > 1 })}
      <section class="${escapeAttribute(pageOptions.listClass)}" data-paged-list>
        ${pageItems.length > 0 ? pageItems.map((item, index) => renderItem(item, index)).join('\n') : `<p>${escapeHtml(localeText(manifest.locales, language, 'common.noItems'))}</p>`}
      </section>
      ${renderPagination(manifest, language, baseRelative, page, pageCount)}`;
    const pageTitle = page === 1 ? pageOptions.title : `${pageOptions.title} · ${localeText(manifest.locales, language, 'common.page', { page })}`;
    await writePage(outputRoot, manifest, language, relative, layout(manifest, language, `${relative}/`, {
      title: pageTitle,
      description: pageOptions.description,
      noindex: pageOptions.noindex,
      body
    }));
  }
}

function artworkTabs(manifest, language, activeKey, oldest) {
  const prefix = (key) => {
    const segment = key === 'popular' ? 'artworks' : `artworks/${key}`;
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
  for (const [filterKey, scopes] of Object.entries(SCOPE_FILTERS)) {
    for (const direction of ['desc', 'asc']) {
      const oldest = direction === 'asc';
      const baseSegment = filterKey === 'popular' ? 'artworks' : `artworks/${filterKey}`;
      const baseRelative = oldest ? `${baseSegment}/oldest` : baseSegment;
      const tabs = artworkTabs(manifest, language, filterKey, oldest);
      const sortHref = routeUrl(manifest, language, oldest ? `${baseSegment}/` : `${baseSegment}/oldest/`);
      const sortLabel = localeText(manifest.locales, language, oldest ? 'common.newest' : 'common.oldest');

      if (filterKey === 'versions' || filterKey === 'all') {
        const versions = manifest.artworks.flatMap((artwork) => artwork.versions
          .filter((version) => scopes.includes(version.scope))
          .map((version) => ({ artwork, version })))
          .sort((a, b) => compareNullableDates(a.version.sortAt, b.version.sortAt, direction) || a.version.key.localeCompare(b.version.key));
        await writePaginatedListing(
          outputRoot,
          manifest,
          language,
          baseRelative,
          versions,
          manifest.site.pageSize?.versions ?? 48,
          (item, index) => renderVersionCard(manifest, item.artwork, item.version, language, index),
          {
            heading: localeText(manifest.locales, language, `artworks.${filterKey}`),
            title: `${localeText(manifest.locales, language, `artworks.${filterKey}`)} · stairs2line`,
            description: localizedValue(manifest.site.description, language, manifest.defaultLanguage),
            listClass: 'card-grid',
            noindex: oldest,
            toolbar: { tabs, sortHref, sortLabel }
          }
        );
      } else {
        const artworks = manifest.artworks
          .map((artwork) => ({ artwork, version: chooseRepresentativeVersion(artwork, scopes) }))
          .filter((item) => item.version)
          .sort((a, b) => compareNullableDates(a.artwork.sortAt, b.artwork.sortAt, direction) || a.artwork.id.localeCompare(b.artwork.id));
        await writePaginatedListing(
          outputRoot,
          manifest,
          language,
          baseRelative,
          artworks,
          manifest.site.pageSize?.artworks ?? 36,
          (item, index) => renderArtworkCard(manifest, item.artwork, item.version, language, index),
          {
            heading: localeText(manifest.locales, language, `artworks.${filterKey}`),
            title: `${localeText(manifest.locales, language, `artworks.${filterKey}`)} · stairs2line`,
            description: localizedValue(manifest.site.description, language, manifest.defaultLanguage),
            listClass: 'card-grid',
            noindex: oldest,
            toolbar: { tabs, sortHref, sortLabel }
          }
        );
      }
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
        return `<article class="artwork-media" data-list-item>
          ${mediaElement(manifest, media, language, title, 'artworkVersion', version.key)}
          ${media ? renderPlatformLinks(manifest, media, language) : ''}
          <details>
            <summary>${escapeHtml(localeText(manifest.locales, language, 'common.files'))}: ${media?.existingFiles.length ?? 0}</summary>
            <ul>${(media?.existingFiles ?? []).map((filePath) => `<li><a href="${escapeAttribute(mediaUrl(manifest, filePath))}">${escapeHtml(filePath)}</a> (${manifest.files[filePath]?.byteLength ?? 0} B)</li>`).join('')}</ul>
          </details>
          ${linkedPosts.length > 0 ? `<div class="linked-posts"><strong>${escapeHtml(localeText(manifest.locales, language, 'common.posts'))}</strong><ul>${linkedPosts.map((post) => `<li><a href="${escapeAttribute(routeUrl(manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}/`))}">${escapeHtml(post.key)}</a></li>`).join('')}</ul></div>` : ''}
        </article>`;
      }).join('');
      return `<section class="artwork-version" id="${escapeAttribute(version.id)}">
        <h2>${escapeHtml(version.id)}</h2>
        <p class="metadata">${escapeHtml(artworkDateText(manifest, version, language))} · ${escapeHtml(version.scope)}</p>
        <div class="card-grid" data-paged-list>${mediaHtml}</div>
      </section>`;
    }).join('');

    const body = `<article class="artwork-page">
      <h1>${escapeHtml(title)}</h1>
      <p class="lead">${escapeHtml(description)}</p>
      ${versionHtml}
    </article>`;
    const artworkImage = artwork.versions
      .flatMap((version) => version.mediaIds)
      .map((mediaId) => manifest.media[mediaId]?.displayFile)
      .find(Boolean);
    await writePage(outputRoot, manifest, language, `artworks/${artwork.slug}`, layout(manifest, language, `artworks/${artwork.slug}/`, {
      title: `${title} · stairs2line`,
      description,
      image: artworkImage,
      body
    }));
  }
}

function postsTabs(manifest, language, active) {
  return [
    {
      active: active === 'all',
      href: routeUrl(manifest, language, 'posts/'),
      label: localeText(manifest.locales, language, 'posts.all')
    },
    {
      active: active === 'grouped',
      href: routeUrl(manifest, language, 'posts/by-platform/'),
      label: localeText(manifest.locales, language, 'posts.grouped')
    }
  ];
}

async function buildPostListings(outputRoot, manifest, language) {
  for (const direction of ['desc', 'asc']) {
    const oldest = direction === 'asc';
    const baseRelative = oldest ? 'posts/oldest' : 'posts';
    const posts = [...manifest.posts].sort((a, b) => compareNullableDates(a.publishedAt, b.publishedAt, direction) || a.key.localeCompare(b.key));
    await writePaginatedListing(
      outputRoot,
      manifest,
      language,
      baseRelative,
      posts,
      manifest.site.pageSize?.posts ?? 20,
      (post, index) => renderPostCard(manifest, post, language, index),
      {
        heading: localeText(manifest.locales, language, 'posts.pageTitle'),
        title: `${localeText(manifest.locales, language, 'posts.pageTitle')} · stairs2line`,
        description: localizedValue(manifest.site.description, language, manifest.defaultLanguage),
        listClass: 'post-list',
        noindex: oldest,
        toolbar: {
          tabs: postsTabs(manifest, language, 'all'),
          sortHref: routeUrl(manifest, language, oldest ? 'posts/' : 'posts/oldest/'),
          sortLabel: localeText(manifest.locales, language, oldest ? 'common.newest' : 'common.oldest')
        }
      }
    );
  }

  for (const platform of manifest.platforms) {
    const platformPosts = manifest.posts.filter((post) => post.platform === platform.id);
    if (platformPosts.length === 0) continue;
    for (const direction of ['desc', 'asc']) {
      const oldest = direction === 'asc';
      const baseSegment = `posts/platform/${encodeURIComponent(platform.id)}`;
      const baseRelative = oldest ? `${baseSegment}/oldest` : baseSegment;
      const sorted = [...platformPosts].sort((a, b) => compareNullableDates(a.publishedAt, b.publishedAt, direction) || a.key.localeCompare(b.key));
      const label = platformLabel(platform, language, manifest.defaultLanguage);
      await writePaginatedListing(
        outputRoot,
        manifest,
        language,
        baseRelative,
        sorted,
        manifest.site.pageSize?.posts ?? 20,
        (post, index) => renderPostCard(manifest, post, language, index),
        {
          heading: localeText(manifest.locales, language, 'posts.platformTitle', { platform: label }),
          title: `${label} · ${localeText(manifest.locales, language, 'posts.pageTitle')}`,
          description: localeText(manifest.locales, language, 'posts.genericDescription', { platform: label }),
          listClass: 'post-list',
          noindex: oldest,
          toolbar: {
            tabs: postsTabs(manifest, language, 'grouped'),
            sortHref: routeUrl(manifest, language, oldest ? `${baseSegment}/` : `${baseSegment}/oldest/`),
            sortLabel: localeText(manifest.locales, language, oldest ? 'common.newest' : 'common.oldest')
          }
        }
      );
    }
  }
}

async function buildPlatformIndex(outputRoot, manifest, language) {
  const cards = manifest.platforms.map((platform) => {
    const posts = manifest.posts.filter((post) => post.platform === platform.id);
    if (posts.length === 0) return '';
    const label = platformLabel(platform, language, manifest.defaultLanguage);
    const icon = platformIconUrl(manifest, platform);
    const dated = posts.filter((post) => post.publishedAt).sort((a, b) => compareNullableDates(a.publishedAt, b.publishedAt, 'asc'));
    const first = dated[0]?.publishedAt ? formatDate(dated[0].publishedAt, language, { includeTime: false }) : null;
    const last = dated.at(-1)?.publishedAt ? formatDate(dated.at(-1).publishedAt, language, { includeTime: false }) : null;
    return `<article class="platform-card" data-list-item>
      <h2><a href="${escapeAttribute(routeUrl(manifest, language, `posts/platform/${encodeURIComponent(platform.id)}/`))}">${icon ? `<img src="${escapeAttribute(icon)}" alt="">` : ''}${escapeHtml(label)}</a></h2>
      <p>${posts.length} ${escapeHtml(localeText(manifest.locales, language, 'common.posts').toLowerCase())}</p>
      ${first || last ? `<p class="metadata">${escapeHtml(first ?? '—')} — ${escapeHtml(last ?? '—')}</p>` : ''}
      <div class="platform-preview">${posts.sort((a, b) => compareNullableDates(a.publishedAt, b.publishedAt, 'desc')).slice(0, 3).map((post, index) => renderPostCard(manifest, post, language, index)).join('')}</div>
    </article>`;
  }).filter(Boolean).join('');
  const body = `<h1>${escapeHtml(localeText(manifest.locales, language, 'posts.grouped'))}</h1>
    ${renderToolbar(manifest, language, { tabs: postsTabs(manifest, language, 'grouped'), enableFeed: false })}
    <section class="platform-list" data-paged-list>${cards}</section>`;
  await writePage(outputRoot, manifest, language, 'posts/by-platform', layout(manifest, language, 'posts/by-platform/', {
    title: `${localeText(manifest.locales, language, 'posts.grouped')} · stairs2line`,
    description: localizedValue(manifest.site.description, language, manifest.defaultLanguage),
    body
  }));
}

async function buildPostPages(outputRoot, manifest, language) {
  for (const post of manifest.posts) {
    const platform = manifest.platforms.find((item) => item.id === post.platform);
    const label = platformLabel(platform, language, manifest.defaultLanguage);
    const title = displayTitle(post, language, post.originalLanguage) ?? `${label} ${post.id}`;
    const description = displayDescription(post, language, post.originalLanguage)
      ?? localeText(manifest.locales, language, 'posts.genericDescription', { platform: label });
    const body = `<article class="post-page">${renderPostCard(manifest, post, language, 0)}</article>`;
    const postImage = post.mediaIds
      .map((mediaId) => manifest.media[mediaId]?.displayFile)
      .find(Boolean);
    await writePage(outputRoot, manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}`, layout(manifest, language, `posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}/`, {
      title: `${title} · stairs2line`,
      description,
      image: postImage,
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

function buildViewerIndex(manifest) {
  return {
    media: Object.fromEntries(Object.values(manifest.media).map((media) => [media.id, {
      displayFile: media.displayFile,
      files: media.existingFiles,
      postIds: media.postIds,
      artworkId: media.artworkId,
      versionId: media.versionId
    }])),
    posts: Object.fromEntries(manifest.posts.map((post) => [post.key, {
      key: post.key,
      platform: post.platform,
      status: post.status,
      publishedAt: post.publishedAt,
      title: post.title,
      description: post.description,
      href: post.href
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
  await fs.writeFile(path.join(outputRoot, 'data', 'admin-data.json'), `${JSON.stringify({ site: manifest.site, platforms: manifest.platforms, artworks: manifest.artworks, posts: manifest.posts, media: manifest.media, issues: compilation.issues }, null, 2)}\n`, 'utf8');

  await writePlaceholders(outputRoot, manifest);

  if (options.copyMedia && options.mediaRoot) {
    const mediaDestination = path.join(outputRoot, String(manifest.site.mediaBasePath ?? 'media/stairs2line/').replace(/^\/+|\/+$/g, ''));
    await copyDirectory(options.mediaRoot, mediaDestination);
  }

  for (const language of manifest.languages) {
    await buildArtworkListings(outputRoot, manifest, language);
    await buildArtworkPages(outputRoot, manifest, language);
    await buildPostListings(outputRoot, manifest, language);
    await buildPlatformIndex(outputRoot, manifest, language);
    await buildPostPages(outputRoot, manifest, language);
  }

  const rootRedirect = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${escapeAttribute(routeUrl(manifest, manifest.defaultLanguage, 'artworks/'))}"><link rel="canonical" href="${escapeAttribute(routeUrl(manifest, manifest.defaultLanguage, 'artworks/'))}">`;
  await fs.writeFile(path.join(outputRoot, 'index.html'), rootRedirect, 'utf8');
  await writeSitemaps(outputRoot, manifest);

  return manifest;
}
