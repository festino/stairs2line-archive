import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileArchive, resolveSourceFiles } from '../src/core/compiler.mjs';
import { DEFAULT_LOCALES } from '../src/core/default-data.mjs';
import { buildFileCatalog, extractLegacyMediaId, extractPostIdFromFile } from '../src/core/file-catalog.mjs';
import { parseLegacyArchive } from '../src/core/legacy-parser.mjs';
import { buildStaticSite } from '../src/core/site-builder.mjs';
import { upgradeSourcePosts } from '../src/core/source-upgrader.mjs';

const TWITTER_FILE = 'twitter/123456789012345678_ABCDEF123456789.png';
const PIXIV_FILE = 'pixiv/999_p0.png';
const MISSING_FILE = 'pixiv/missing.png';
const MEDIA_ID = 'artwork-0001/v01/m01';
const ORPHAN_TWITTER_FILE = 'twitter/COJhPv9UsAAvk7w.png';
const UNKNOWN_OTHER_FILE = 'other/before-2018-02-24_18ac61fd0b9bf40272f9905d74fa1bd0eb3609cf3cb9-eAQRcV_fw1200.png';
const TWITTER_LAYOUT_FILES = [
  'twitter/200000000000000001_LAYOUT000000001.png',
  'twitter/200000000000000002_LAYOUT000000002.png',
  'twitter/200000000000000003_LAYOUT000000003.png',
  'twitter/200000000000000004_LAYOUT000000004.png'
];

function fakePng(width, height, extraBytes = 0) {
  const buffer = Buffer.alloc(24 + extraBytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const TWITTER_EPOCH_MS = 1288834974657n;

function twitterMediaIdAt(isoDate, discriminator = 0) {
  const milliseconds = BigInt(Date.parse(isoDate));
  const snowflake = ((milliseconds - TWITTER_EPOCH_MS) << 22n) | BigInt(discriminator & 0x3fffff);
  const bytes = Buffer.alloc(9);
  bytes.writeBigUInt64BE(snowflake, 0);
  bytes[8] = discriminator & 0xff;
  return bytes.toString('base64url');
}

function fixtureSource() {
  return {
    site: {
      id: 'test',
      schemaVersion: 2,
      basePath: '/repo/',
      mediaBasePath: 'media/stairs2line/',
      defaultLanguage: 'en',
      languages: ['ru', 'en', 'ja'],
      mediaDirectories: ['twitter', 'pixiv'],
      pageSize: { artworks: 10, versions: 10, posts: 10 },
      title: { default: 'Archive' },
      description: { default: 'Archive description' }
    },
    platforms: {
      platforms: [
        {
          id: 'twitter',
          label: { default: 'Twitter' },
          defaultAccount: 'stairs2line',
          postUrlTemplate: 'https://twitter.com/{account}/status/{id}',
          versions: [{ account: 'stairs2line', sourceUrl: 'https://twitter.com/stairs2line' }]
        },
        {
          id: 'pixiv',
          label: { default: 'pixiv' },
          postUrlTemplate: 'https://www.pixiv.net/artworks/{id}',
          versions: [{ sourceUrl: 'https://www.pixiv.net/users/1593221' }]
        },
        {
          id: 'tumblr',
          label: { default: 'Tumblr' },
          defaultAccount: 'stairs2line',
          postUrlTemplate: 'https://{account}.tumblr.com/post/{id}',
          versions: [{ account: 'stairs2line', sourceUrl: 'https://stairs2line.tumblr.com/' }]
        }
      ]
    },
    locales: DEFAULT_LOCALES,
    posts: [
      {
        key: 'twitter:123456789012345678',
        platform: 'twitter',
        id: '123456789012345678',
        status: 'alive',
        publishedAt: '2020-01-01T00:00:00Z',
        versions: [
          {
            originalLanguage: 'ja',
            description: { ja: '説明' },
            media: [TWITTER_FILE]
          }
        ],
        __source: '/source/posts/twitter.jsonc'
      },
      {
        key: 'pixiv:999',
        platform: 'pixiv',
        id: '999',
        status: 'alive',
        versions: [
          {
            originalLanguage: 'ja',
            media: [PIXIV_FILE]
          }
        ],
        __source: '/source/posts/pixiv.jsonc'
      }
    ],
    artworks: [
      {
        id: 'artwork-0001',
        title: { ja: '作品' },
        description: { ja: '説明' },
        versions: [
          {
            id: 'v01',
            scope: 'top',
            media: [
              {
                id: MEDIA_ID,
                files: [MISSING_FILE, TWITTER_FILE, PIXIV_FILE],
                legacyIds: ['ABCDEF123456789', '999_p0', 'missing-id']
              }
            ]
          }
        ],
        __source: '/source/artworks/0001.jsonc'
      }
    ]
  };
}

async function createMediaFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-media-'));
  await fs.mkdir(path.join(root, 'twitter'), { recursive: true });
  await fs.mkdir(path.join(root, 'pixiv'), { recursive: true });
  await fs.writeFile(path.join(root, TWITTER_FILE), fakePng(400, 400, 100));
  await fs.writeFile(path.join(root, PIXIV_FILE), fakePng(400, 400, 10));
  return root;
}

async function createTwitterLayoutMediaFixture(dimensions = [[1200, 800], [800, 1200], [1600, 900], [900, 1600]]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-twitter-layout-'));
  await fs.mkdir(path.join(root, 'twitter'), { recursive: true });
  for (let index = 0; index < TWITTER_LAYOUT_FILES.length; index += 1) {
    const [width, height] = dimensions[index] ?? [1200, 800];
    await fs.writeFile(path.join(root, TWITTER_LAYOUT_FILES[index]), fakePng(width, height, index));
  }
  return root;
}

function twitterLayoutSource(counts = [1, 2, 3, 4]) {
  const source = fixtureSource();
  source.site.mediaDirectories = ['twitter'];
  source.posts = counts.map((count) => ({
    key: `twitter:20000000000000000${count}`,
    platform: 'twitter',
    id: `20000000000000000${count}`,
    status: 'alive',
    publishedAt: `2024-01-0${count}T00:00:00Z`,
    versions: [{
      originalLanguage: 'en',
      description: { en: `${count} image layout` },
      media: TWITTER_LAYOUT_FILES.slice(0, count)
    }],
    __source: '/source/posts/twitter.jsonc'
  }));
  source.artworks = [{
    id: 'artwork-twitter-layout',
    title: { en: 'Twitter layout' },
    versions: [{
      id: 'v01',
      scope: 'top',
      media: TWITTER_LAYOUT_FILES.map((filePath, index) => ({
        id: `artwork-twitter-layout/v01/m${String(index + 1).padStart(2, '0')}`,
        files: [filePath]
      }))
    }],
    __source: '/source/artworks/twitter-layout.jsonc'
  }];
  return source;
}

test('legacy parser migrates all current records and stores status on each post', async () => {
  const legacyPath = new URL('./fixtures/legacy-page.txt', import.meta.url);
  const migration = await parseLegacyArchive(legacyPath);
  assert.equal(migration.report.postCount, 243);
  assert.equal(migration.report.artworkCount, 239);
  assert.equal(migration.report.versionCount, 401);
  assert.equal(migration.report.legacyMediaIdCount, 505);
  assert.ok(migration.posts.every((post) => ['alive', 'deleted'].includes(post.status)));
  assert.equal(migration.posts.find((post) => post.key === 'twitter:583667739211898880').status, 'deleted');
  assert.equal(migration.artworks.find((artwork) => artwork.id === 'artwork-0048').title.ja, 'ごろん');
});

test('legacy file ID extraction preserves the current filename conventions', () => {
  assert.equal(extractLegacyMediaId(TWITTER_FILE), 'ABCDEF123456789');
  assert.equal(extractLegacyMediaId('tumblr/92164287224_tumblr_n8x7q9MNVH1s4v84ho1_540.png'), 'n8x7q9MNVH1s4v84ho1_540');
  assert.equal(extractLegacyMediaId(PIXIV_FILE), '999_p0');
  assert.equal(extractPostIdFromFile('other/sENMiFJpci.png', [
    { key: 'instagram:sENMiFJpci', platform: 'instagram', id: 'sENMiFJpci' }
  ]), 'instagram:sENMiFJpci');
});

test('compiler selects the smallest existing equivalent file and tolerates missing candidates', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  const compilation = await compileArchive(source, { mediaRoot });
  const media = compilation.manifest.media[MEDIA_ID];

  assert.equal(media.displayFile, PIXIV_FILE);
  assert.deepEqual(media.existingFiles.sort(), [PIXIV_FILE, TWITTER_FILE]);
  assert.equal(compilation.issues.some((issue) => issue.code === 'media.no-existing-file'), false);
  assert.equal(compilation.issues.some((issue) => issue.code === 'media.some-files-missing'), true);
});

test('post filenames identify logical media while display uses its smallest equivalent file', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.posts = [source.posts[0]];
  const compilation = await compileArchive(source, { mediaRoot });
  const post = compilation.manifest.posts[0];
  const mediaRef = post.versions[0].mediaRefs[0];

  assert.equal(mediaRef.filePath, TWITTER_FILE);
  assert.equal(mediaRef.mediaId, MEDIA_ID);
  assert.equal(mediaRef.displayFile, PIXIV_FILE);
  assert.deepEqual(post.versions[0].mediaFiles, [TWITTER_FILE]);

  // A post references the logical media entity, so all of that media's
  // equivalent physical files count as assigned to the post.
  assert.equal(
    compilation.issues.some((issue) => issue.code === 'file.unassigned-to-post' && issue.entityId === PIXIV_FILE),
    false
  );
});

test('resolve step upgrades legacy posts to filename references and preserves auto-linking', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.site.schemaVersion = 1;
  delete source.platforms.platforms[0].versions;
  source.artworks[0].versions[0].media[0].files = [MISSING_FILE];
  source.posts[0] = {
    key: 'twitter:123456789012345678',
    platform: 'twitter',
    id: '123456789012345678',
    status: 'alive',
    publishedAt: '2020-01-01T00:00:00Z',
    originalLanguage: 'ja',
    description: { ja: '説明' },
    media: [],
    legacyAutoLink: true,
    __source: '/source/posts/twitter.jsonc'
  };

  const knownPostIds = source.posts.map((post) => ({ key: post.key, platform: post.platform, id: post.id }));
  const catalog = await buildFileCatalog(mediaRoot, {
    includeDirectories: source.site.mediaDirectories,
    knownPostIds
  });
  resolveSourceFiles(source, catalog);

  const media = source.artworks[0].versions[0].media[0];
  assert.equal(media.files[0], PIXIV_FILE);
  assert.ok(media.files.includes(TWITTER_FILE));
  assert.equal(source.site.schemaVersion, 2);
  assert.deepEqual(source.posts[0].versions[0].media, [TWITTER_FILE]);
  assert.equal('media' in source.posts[0], false);
  assert.equal(source.platforms.platforms[0].versions[0].account, 'stairs2line');
});

test('post versions keep mutable fields and layout independent', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.posts = [
    {
      key: 'tumblr:42',
      platform: 'tumblr',
      id: '42',
      status: 'deleted',
      publishedAt: '2020-02-01T00:00:00Z',
      versions: [
        {
          title: { en: 'First' },
          media: [TWITTER_FILE]
        },
        {
          title: { en: 'Second' },
          media: [PIXIV_FILE],
          layout: [{ type: 'rows', display: [{ blocks: [0] }] }]
        }
      ],
      __source: '/source/posts/tumblr.jsonc'
    }
  ];

  const compilation = await compileArchive(source, { mediaRoot });
  const post = compilation.manifest.posts[0];

  assert.equal(post.versions.length, 2);
  assert.equal(post.versions[0].title.en, 'First');
  assert.equal(post.versions[1].title.en, 'Second');
  assert.equal(post.versions[0].layout, null);
  assert.deepEqual(post.versions[1].layout, [{ type: 'rows', display: [{ blocks: [0] }] }]);
  assert.equal(post.status, 'deleted');
  assert.equal(post.mediaRefs[0].displayFile, PIXIV_FILE);
  assert.equal(compilation.issues.some((issue) => issue.code.startsWith('post.layout-')), false);
});

test('missing translation warnings are deduplicated by entity', async () => {
  const mediaRoot = await createMediaFixture();
  const compilation = await compileArchive(fixtureSource(), { mediaRoot });
  const warnings = compilation.issues.filter((issue) => issue.code === 'i18n.missing' && issue.entityId === 'artwork-0001');
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].missing, {
    title: ['en', 'ru'],
    description: ['en', 'ru']
  });
});

test('an alive post without a date is compiled as deleted', async () => {
  const mediaRoot = await createMediaFixture();
  const compilation = await compileArchive(fixtureSource(), { mediaRoot });
  const post = compilation.manifest.posts.find((item) => item.key === 'pixiv:999');
  assert.equal(post.status, 'deleted');
  assert.equal(compilation.issues.some((issue) => issue.code === 'post.date-missing-treated-deleted'), true);
});

test('static pages use the logical media display file and expose paged/feed controls', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.site.pageSize.artworks = 1;
  const secondArtwork = structuredClone(source.artworks[0]);
  secondArtwork.id = 'artwork-0002';
  secondArtwork.versions[0].key = undefined;
  secondArtwork.versions[0].media[0].id = 'artwork-0002/v01/m01';
  source.artworks.push(secondArtwork);
  const compilation = await compileArchive(source, { mediaRoot });
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-site-'));
  await buildStaticSite(compilation, source, output, { mediaRoot, copyMedia: true });

  const artworkHtml = await fs.readFile(path.join(output, 'en', 'artworks', 'index.html'), 'utf8');
  assert.match(artworkHtml, /<img[^>]+src="\/repo\/media\/stairs2line\/pixiv\/999_p0\.png"/);
  assert.match(artworkHtml, /data-feed-toggle/);
  assert.match(artworkHtml, /data-paged-list/);
  assert.match(artworkHtml, /href="\/repo\/en\/artworks\/oldest\/"/);

  const twitterHtml = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'twitter', 'index.html'), 'utf8');
  assert.match(twitterHtml, /compact-grid--twitter/);
  assert.match(twitterHtml, /<img src="\/repo\/media\/stairs2line\/pixiv\/999_p0\.png"/);
  assert.doesNotMatch(twitterHtml, /post-media-count-1 twitter-single-media--natural/);
  assert.match(twitterHtml, /<h1 class="platform-hero-title">Twitter<\/h1>/);
  assert.doesNotMatch(twitterHtml, /Posts on Twitter/);

  const twitterFullHtml = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'twitter', 'full', 'index.html'), 'utf8');
  assert.match(twitterFullHtml, /<img[^>]+data-file-path="twitter\/123456789012345678_ABCDEF123456789\.png"[^>]+src="\/repo\/media\/stairs2line\/pixiv\/999_p0\.png"/);
  assert.match(twitterFullHtml, /post-media-count-1 twitter-single-media--natural/);
  assert.doesNotMatch(twitterFullHtml, /class="post-platform"/);
  assert.match(twitterFullHtml, /<h1 class="platform-hero-title">Twitter<\/h1>/);
  assert.doesNotMatch(twitterFullHtml, /Posts on Twitter/);
  assert.match(twitterFullHtml, /class="post-original-link-icon"[^>]+title="Open original post"/);

  const twitterDetailHtml = await fs.readFile(path.join(output, 'en', 'posts', 'twitter', '123456789012345678', 'index.html'), 'utf8');
  assert.match(twitterDetailHtml, /class="post-platform"/);
  assert.match(twitterDetailHtml, /class="post-original-link-icon"[^>]+title="Open original post"/);

  const twitterCompactHtml = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'twitter', 'compact', 'index.html'), 'utf8');
  assert.match(twitterCompactHtml, /compact-grid--twitter/);

  const postsHtml = await fs.readFile(path.join(output, 'en', 'posts', 'index.html'), 'utf8');
  assert.match(postsHtml, /<body class="post-activity-page"/);
  assert.match(postsHtml, /class="post-activity"/);
  assert.match(postsHtml, /class="activity-popover"/);
  assert.doesNotMatch(postsHtml, /class="post-list"/);

  const archiveCss = await fs.readFile(path.join(output, 'assets', 'archive.css'), 'utf8');
  assert.match(archiveCss, /\.platform-page \.post-card \.post-media-item \.media-link img,[\s\S]*?max-height:\s*min\(62dvh, 680px\)/);
  assert.match(archiveCss, /\.platform-page--pixiv \.post-card--pixiv[\s\S]*?max-height:\s*min\(62dvh, 680px\)/);
  assert.doesNotMatch(archiveCss, /^\.post-card--(?:pixiv|twitter|tumblr)\s*\{/m);
});


test('twitter full view derives 1-4 image layouts from media count without a layout field', async () => {
  const mediaRoot = await createTwitterLayoutMediaFixture();
  const source = twitterLayoutSource();
  const compilation = await compileArchive(source, { mediaRoot });
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-twitter-layout-site-'));
  await buildStaticSite(compilation, source, output, { mediaRoot, copyMedia: true });

  const twitterHtml = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'twitter', 'full', 'index.html'), 'utf8');
  assert.match(twitterHtml, /post-media-count-1 twitter-single-media--natural/);
  assert.match(twitterHtml, /post-media-count-2/);
  assert.match(twitterHtml, /post-media-count-3/);
  assert.match(twitterHtml, /post-media-count-4/);
  assert.equal(source.posts.some((post) => 'layout' in post.versions[0]), false);

  const archiveCss = await fs.readFile(path.join(output, 'assets', 'archive.css'), 'utf8');
  assert.match(archiveCss, /post-media-count-2,[\s\S]*?post-media-count-4[\s\S]*?aspect-ratio:\s*16 \/ 9/);
  assert.match(archiveCss, /post-media-count-3 \.post-media-item:first-child[\s\S]*?grid-row:\s*1 \/ span 2/);
  assert.match(archiveCss, /post-media-count-2 img,[\s\S]*?post-media-count-4 video[\s\S]*?object-fit:\s*cover/);
});

test('twitter single-image view only crops aspect ratios outside the supported 3:4 to 2:1 range', async () => {
  const cases = [
    { dimensions: [1200, 1200], expected: 'twitter-single-media--natural' },
    { dimensions: [2400, 600], expected: 'twitter-single-media--wide' },
    { dimensions: [600, 1200], expected: 'twitter-single-media--tall' }
  ];

  for (const { dimensions, expected } of cases) {
    const mediaRoot = await createTwitterLayoutMediaFixture([dimensions]);
    const source = twitterLayoutSource([1]);
    const compilation = await compileArchive(source, { mediaRoot });
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-twitter-single-site-'));
    await buildStaticSite(compilation, source, output, { mediaRoot });
    const twitterHtml = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'twitter', 'full', 'index.html'), 'utf8');
    assert.match(twitterHtml, new RegExp(`post-media-count-1 ${expected}`));
  }
});


test('post index uses month activity cells with post thumbnails and no artwork/version aggregation', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.posts.push({
    key: 'twitter:123456789012345679',
    platform: 'twitter',
    id: '123456789012345679',
    status: 'alive',
    publishedAt: '2020-01-20T00:00:00Z',
    versions: [{ originalLanguage: 'en', title: { en: 'Second January post' }, media: [TWITTER_FILE] }],
    __source: '/source/posts/twitter.jsonc'
  });
  const compilation = await compileArchive(source, { mediaRoot });
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-activity-site-'));
  await buildStaticSite(compilation, source, output, { mediaRoot });

  const html = await fs.readFile(path.join(output, 'en', 'posts', 'index.html'), 'utf8');
  assert.match(html, /<section class="activity-year"><h2>2020<\/h2>/);
  assert.match(html, /<details class="activity-month"[^>]*>[\s\S]*?<span class="activity-month-dot" data-activity-level="[1-5]"><span>2<\/span>/);
  assert.match(html, /activity-post-thumbnail/);
  assert.match(html, /Posts: 2/);
  assert.match(html, /January 20, 2020 · Twitter/);
  assert.doesNotMatch(html, /artworkCount|versionCount|unique artworks/i);

  const css = await fs.readFile(path.join(output, 'assets', 'archive.css'), 'utf8');
  assert.match(css, /\.activity-popover\s*\{[\s\S]*?display:\s*block/);
});

test('platform directory uses bounded two-column cards with thumbnail previews', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  const compilation = await compileArchive(source, { mediaRoot });
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-platform-index-'));
  await buildStaticSite(compilation, source, output, { mediaRoot });

  const html = await fs.readFile(path.join(output, 'en', 'posts', 'by-platform', 'index.html'), 'utf8');
  assert.match(html, /class="platform-list"/);
  assert.match(html, /class="platform-preview-post"/);
  assert.match(html, /class="platform-source-link" href="https:\/\/twitter\.com\/stairs2line"[^>]*>Official page/);
  assert.doesNotMatch(html, /<div class="platform-preview"><article class="post-card/);
  const twitterIndex = html.indexOf('platform-card--twitter');
  const pixivIndex = html.indexOf('platform-card--pixiv');
  assert.ok(twitterIndex >= 0 && pixivIndex > twitterIndex, 'platform cards preserve platforms.jsonc order');

  const css = await fs.readFile(path.join(output, 'assets', 'archive.css'), 'utf8');
  assert.match(css, /\.platform-list\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.platform-card-bio[\s\S]*?-webkit-line-clamp:\s*3/);
});

test('platform profile snapshots are versioned and the latest snapshot drives the hero', async () => {
  const mediaRoot = await createMediaFixture();
  await fs.mkdir(path.join(mediaRoot, 'profiles'), { recursive: true });
  await fs.writeFile(path.join(mediaRoot, 'profiles', 'twitter-avatar.png'), fakePng(256, 256, 5));
  await fs.writeFile(path.join(mediaRoot, 'profiles', 'twitter-banner.png'), fakePng(1200, 400, 8));

  const source = fixtureSource();
  source.platforms.platforms[0].versions = [
    {
      observedAt: '2019-01-01',
      account: 'oldstairs',
      description: { en: 'Old profile bio' }
    },
    {
      observedAt: '2020-01-01',
      account: 'stairs2line',
      description: { en: 'Current profile bio' },
      sourceUrl: 'https://twitter.com/stairs2line',
      avatar: 'profiles/twitter-avatar.png',
      banner: 'profiles/twitter-banner.png'
    }
  ];

  const compilation = await compileArchive(source, { mediaRoot });
  const twitter = compilation.manifest.platforms.find((platform) => platform.id === 'twitter');
  assert.equal(twitter.versions.length, 2);
  assert.equal(twitter.description.en, 'Current profile bio');
  assert.equal(twitter.sourceUrl, 'https://twitter.com/stairs2line');
  assert.equal(twitter.avatar, 'profiles/twitter-avatar.png');
  assert.equal(twitter.banner, 'profiles/twitter-banner.png');
  assert.equal(compilation.issues.some((issue) => issue.code.startsWith('platform.') && issue.severity === 'error'), false);

  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-platform-profile-'));
  await buildStaticSite(compilation, source, output, { mediaRoot });
  const html = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'twitter', 'index.html'), 'utf8');
  assert.match(html, /Current profile bio/);
  assert.match(html, /profiles\/twitter-avatar\.png/);
  assert.match(html, /<img class="platform-banner-backdrop" src="\/repo\/media\/stairs2line\/profiles\/twitter-banner\.png" alt="" aria-hidden="true">/);
  assert.match(html, /<img class="platform-banner-image" src="\/repo\/media\/stairs2line\/profiles\/twitter-banner\.png" alt="">/);
  assert.match(html, /class="platform-source-link" href="https:\/\/twitter\.com\/stairs2line"[^>]*>Official page/);
  assert.match(html, /class="active" href="\/repo\/en\/posts\/platform\/twitter\/">Compact view<\/a>/);
  assert.match(html, /href="\/repo\/en\/posts\/platform\/twitter\/full\/">Full view<\/a>/);

  const directoryHtml = await fs.readFile(path.join(output, 'en', 'posts', 'by-platform', 'index.html'), 'utf8');
  assert.match(directoryHtml, /<img class="platform-banner-backdrop" src="\/repo\/media\/stairs2line\/profiles\/twitter-banner\.png" alt="" aria-hidden="true">/);
  assert.match(directoryHtml, /<img class="platform-banner-image" src="\/repo\/media\/stairs2line\/profiles\/twitter-banner\.png" alt="">/);
  const css = await fs.readFile(path.join(output, 'assets', 'archive.css'), 'utf8');
  assert.match(css, /\.platform-hero-banner \.platform-banner-image,[\s\S]*?object-fit:\s*contain/);
  assert.match(css, /\.platform-banner-backdrop\s*\{[\s\S]*?object-fit:\s*cover/);
});

test('missing versioned platform profile assets are validation errors', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.platforms.platforms[0].versions = [{
    account: 'stairs2line',
    avatar: 'profiles/missing-avatar.png',
    banner: 'profiles/missing-banner.png'
  }];
  const compilation = await compileArchive(source, { mediaRoot });
  assert.equal(compilation.issues.some((issue) => issue.code === 'platform.avatar-missing'), true);
  assert.equal(compilation.issues.some((issue) => issue.code === 'platform.banner-missing'), true);
});


test('platform profile assets distinguish explicit null from unknown omitted fields', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  const pixiv = source.platforms.platforms.find((platform) => platform.id === 'pixiv');
  const twitter = source.platforms.platforms.find((platform) => platform.id === 'twitter');
  pixiv.versions = [{ account: '1593221', avatar: null, banner: null }];
  twitter.versions = [{ account: 'stairs2line' }];

  const upgraded = upgradeSourcePosts(structuredClone(source));
  const upgradedPixiv = upgraded.platforms.platforms.find((platform) => platform.id === 'pixiv');
  assert.equal(upgradedPixiv.versions[0].avatar, null);
  assert.equal(upgradedPixiv.versions[0].banner, null);

  const legacySource = fixtureSource();
  const legacyPixiv = legacySource.platforms.platforms.find((platform) => platform.id === 'pixiv');
  delete legacyPixiv.versions;
  legacyPixiv.avatar = null;
  legacyPixiv.banner = null;
  const upgradedLegacy = upgradeSourcePosts(legacySource);
  const upgradedLegacyPixiv = upgradedLegacy.platforms.platforms.find((platform) => platform.id === 'pixiv');
  assert.equal(upgradedLegacyPixiv.versions[0].avatar, null);
  assert.equal(upgradedLegacyPixiv.versions[0].banner, null);

  const compilation = await compileArchive(upgraded, { mediaRoot });
  const compiledPixiv = compilation.manifest.platforms.find((platform) => platform.id === 'pixiv');
  const compiledTwitter = compilation.manifest.platforms.find((platform) => platform.id === 'twitter');
  assert.equal(Object.hasOwn(compiledPixiv.versions[0], 'avatar'), true);
  assert.equal(Object.hasOwn(compiledPixiv.versions[0], 'banner'), true);
  assert.equal(compiledPixiv.versions[0].avatar, null);
  assert.equal(compiledPixiv.versions[0].banner, null);
  assert.equal(Object.hasOwn(compiledTwitter.versions[0], 'avatar'), true);
  assert.equal(Object.hasOwn(compiledTwitter.versions[0], 'banner'), true);
  assert.equal(compiledTwitter.versions[0].avatar, undefined);
  assert.equal(compiledTwitter.versions[0].banner, undefined);
  assert.equal(compilation.issues.some((issue) => issue.code === 'platform.avatar-missing' || issue.code === 'platform.banner-missing'), false);

  const schema = JSON.parse(await fs.readFile(new URL('../schemas/archive-source.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.$defs.platformVersion.properties.avatar.type, ['string', 'null']);
  assert.deepEqual(schema.$defs.platformVersion.properties.banner.type, ['string', 'null']);

  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-platform-null-'));
  await buildStaticSite(compilation, upgraded, output, { mediaRoot });
  const pixivHtml = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'pixiv', 'index.html'), 'utf8');
  const twitterHtml = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'twitter', 'index.html'), 'utf8');
  assert.match(pixivHtml, /platform-hero--pixiv platform-hero--no-banner/);
  assert.doesNotMatch(twitterHtml, /platform-hero--twitter platform-hero--no-banner/);
});


test('artwork media may define two pixel viewer anchor points used only on the artwork detail page', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.artworks[0].versions[0].media[0].viewerAnchor = {
    file: TWITTER_FILE,
    points: [
      { x: 100.5, y: 120.25 },
      { x: 300.25, y: 320.75 }
    ]
  };

  const compilation = await compileArchive(source, { mediaRoot });
  assert.deepEqual(compilation.manifest.media[MEDIA_ID].viewerAnchor, {
    file: TWITTER_FILE,
    points: [
      { x: 100.5, y: 120.25 },
      { x: 300.25, y: 320.75 }
    ]
  });
  assert.deepEqual(compilation.manifest.media[MEDIA_ID].viewerAlignment, {
    points: [
      { x: 100.5, y: 120.25 },
      { x: 300.25, y: 320.75 }
    ]
  });
  assert.equal(compilation.issues.some((issue) => issue.code === 'media.viewer-anchor-invalid'), false);

  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-viewer-anchor-'));
  await buildStaticSite(compilation, source, output, { mediaRoot });
  const detailHtml = await fs.readFile(path.join(output, 'en', 'artworks', 'artwork-0001', 'index.html'), 'utf8');
  assert.match(detailHtml, /data-viewer-align="artwork"/);
  assert.match(detailHtml, /data-viewer-align-group="artwork-0001"/);
  assert.match(detailHtml, /data-viewer-anchor-x1="100\.5"/);
  assert.match(detailHtml, /data-viewer-anchor-y1="120\.25"/);
  assert.match(detailHtml, /data-viewer-anchor-x2="300\.25"/);
  assert.match(detailHtml, /data-viewer-anchor-y2="320\.75"/);

  const listingHtml = await fs.readFile(path.join(output, 'en', 'artworks', 'index.html'), 'utf8');
  assert.doesNotMatch(listingHtml, /data-viewer-align="artwork"/);

  const schema = JSON.parse(await fs.readFile(new URL('../schemas/archive-source.schema.json', import.meta.url), 'utf8'));
  const anchorSchema = schema.$defs.media.properties.viewerAnchor;
  assert.deepEqual(anchorSchema.required, ['points']);
  assert.equal(anchorSchema.properties.points.minItems, 2);
  assert.equal(anchorSchema.properties.points.maxItems, 2);
  assert.equal(Object.hasOwn(anchorSchema.properties.points.items.properties.x, 'minimum'), false);
  assert.equal(Object.hasOwn(anchorSchema.properties.points.items.properties.y, 'minimum'), false);
  assert.equal(anchorSchema.properties.flipX.type, 'boolean');
  assert.equal(anchorSchema.properties.rotation.type, 'number');
});

test('viewer anchor orientation supports optional flipX and clockwise rotation', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.artworks[0].versions[0].media[0].viewerAnchor = {
    file: TWITTER_FILE,
    flipX: true,
    rotation: 180,
    points: [
      { x: 80.5, y: 300.25 },
      { x: 320.25, y: 90.5 }
    ]
  };

  const compilation = await compileArchive(source, { mediaRoot });
  assert.deepEqual(compilation.manifest.media[MEDIA_ID].viewerAnchor, {
    file: TWITTER_FILE,
    flipX: true,
    rotation: 180,
    points: [
      { x: 80.5, y: 300.25 },
      { x: 320.25, y: 90.5 }
    ]
  });
  assert.deepEqual(compilation.manifest.media[MEDIA_ID].viewerAlignment, {
    points: [
      { x: 80.5, y: 300.25 },
      { x: 320.25, y: 90.5 }
    ],
    flipX: true,
    rotation: 180
  });

  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-viewer-orientation-'));
  await buildStaticSite(compilation, source, output, { mediaRoot });
  const detailHtml = await fs.readFile(path.join(output, 'en', 'artworks', 'artwork-0001', 'index.html'), 'utf8');
  assert.match(detailHtml, /data-viewer-flip-x="true"/);
  assert.match(detailHtml, /data-viewer-rotation="180"/);

  const omittedSource = fixtureSource();
  omittedSource.artworks[0].versions[0].media[0].viewerAnchor = {
    file: TWITTER_FILE,
    points: [{ x: 80, y: 300 }, { x: 320, y: 90 }]
  };
  const omittedCompilation = await compileArchive(omittedSource, { mediaRoot });
  assert.equal(Object.hasOwn(omittedCompilation.manifest.media[MEDIA_ID].viewerAnchor, 'flipX'), false);
  assert.equal(Object.hasOwn(omittedCompilation.manifest.media[MEDIA_ID].viewerAnchor, 'rotation'), false);
  assert.equal(Object.hasOwn(omittedCompilation.manifest.media[MEDIA_ID].viewerAlignment, 'flipX'), false);
  assert.equal(Object.hasOwn(omittedCompilation.manifest.media[MEDIA_ID].viewerAlignment, 'rotation'), false);
});

test('viewer anchor pixels are rescaled from an explicit reference file to the lightest display file', async () => {
  const mediaRoot = await createMediaFixture();
  const hiResFile = 'pixiv/999_p0_hires.png';
  await fs.writeFile(path.join(mediaRoot, hiResFile), fakePng(800, 800, 300));

  const source = fixtureSource();
  source.artworks[0].versions[0].media[0].files = [hiResFile, PIXIV_FILE];
  source.artworks[0].versions[0].media[0].viewerAnchor = {
    file: hiResFile,
    points: [
      { x: 200, y: 200 },
      { x: 600, y: 600 }
    ]
  };
  source.posts = source.posts.filter((post) => post.platform === 'pixiv');

  const compilation = await compileArchive(source, { mediaRoot });
  assert.equal(compilation.manifest.media[MEDIA_ID].displayFile, PIXIV_FILE);
  assert.deepEqual(compilation.manifest.media[MEDIA_ID].viewerAlignment, {
    points: [
      { x: 100, y: 100 },
      { x: 300, y: 300 }
    ]
  });
});

test('omitted viewerAnchor.file stays omitted and uses the first usable declared image as its coordinate reference', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.artworks[0].versions[0].media[0].files = [TWITTER_FILE, PIXIV_FILE];
  source.artworks[0].versions[0].media[0].viewerAnchor = {
    points: [
      { x: 40.5, y: 80.25 },
      { x: 320.75, y: 300.5 }
    ]
  };

  const compilation = await compileArchive(source, { mediaRoot });
  assert.deepEqual(compilation.manifest.media[MEDIA_ID].viewerAnchor, {
    points: [
      { x: 40.5, y: 80.25 },
      { x: 320.75, y: 300.5 }
    ]
  });
  assert.equal(Object.hasOwn(compilation.manifest.media[MEDIA_ID].viewerAnchor, 'file'), false);
});



test('viewer anchors may use coordinates outside a cropped image so non-overlapping crops can share one alignment frame', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.artworks[0].versions[0].media[0].viewerAnchor = {
    file: TWITTER_FILE,
    points: [
      { x: -125.5, y: 80.25 },
      { x: 620.75, y: 510.5 }
    ]
  };

  const compilation = await compileArchive(source, { mediaRoot });
  assert.deepEqual(compilation.manifest.media[MEDIA_ID].viewerAnchor, {
    file: TWITTER_FILE,
    points: [
      { x: -125.5, y: 80.25 },
      { x: 620.75, y: 510.5 }
    ]
  });
  assert.deepEqual(compilation.manifest.media[MEDIA_ID].viewerAlignment, {
    points: [
      { x: -125.5, y: 80.25 },
      { x: 620.75, y: 510.5 }
    ]
  });
  assert.equal(compilation.issues.some((issue) => issue.code === 'media.viewer-anchor-invalid'), false);
});
test('admin exposes a visual artwork-version alignment editor and enough source metadata to write anchors back', async () => {
  const mediaRoot = await createMediaFixture();
  const secondFile = 'pixiv/998_p0.png';
  await fs.writeFile(path.join(mediaRoot, secondFile), fakePng(520, 360, 50));

  const source = fixtureSource();
  source.artworks[0].versions.push({
    id: 'v02',
    scope: 'major',
    media: [{
      id: 'artwork-0001/v02/m01',
      files: [secondFile]
    }]
  });
  const compilation = await compileArchive(source, { mediaRoot });
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-admin-alignment-'));
  await buildStaticSite(compilation, source, output, { mediaRoot });

  const adminData = JSON.parse(await fs.readFile(path.join(output, 'data', 'admin-data.json'), 'utf8'));
  assert.equal(adminData.artworkSourceFiles['artwork-0001'], 'artworks/0001.jsonc');
  assert.equal(adminData.files[TWITTER_FILE].width, 400);
  assert.equal(adminData.files[TWITTER_FILE].height, 400);

  const html = await fs.readFile(path.join(output, 'admin', 'index.html'), 'utf8');
  const js = await fs.readFile(path.join(output, 'admin', 'admin.js'), 'utf8');
  const css = await fs.readFile(path.join(output, 'admin', 'admin.css'), 'utf8');
  assert.match(html, /data-tab="alignment"/);
  assert.match(html, /id="alignment-stage"/);
  assert.match(html, /id="alignment-write"/);
  assert.match(html, /id="alignment-zoom-out"/);
  assert.match(html, /id="alignment-zoom-value"/);
  assert.match(html, /id="alignment-fit"/);
  assert.match(js, /media\?\.declaredFiles\?\.\[0\]/);
  assert.match(js, /function sharedAlignmentReferencePoints\(\)/);
  assert.doesNotMatch(js, /no common overlap/);
  assert.match(js, /function inverseLayerPoint\(layer, screenPoint\)/);
  assert.match(js, /window\.showDirectoryPicker/);
  assert.match(js, /media\.viewerAnchor = mediaAnchors\[media\.id\]/);
  assert.match(js, /function setAlignmentZoom\(nextZoom, focalX, focalY\)/);
  assert.match(js, /const width = worldWidth \* zoom/);
  assert.match(js, /frame\.style\.zIndex = alignmentState\.activeLayerId === layer\.id \? '100'/);
  assert.match(js, /frame\.style\.transform = `translate3d\(\$\{screenLeft\}px, \$\{screenTop\}px, 0\)`/);
  assert.doesNotMatch(js, /image\.style\.left =/);
  assert.doesNotMatch(js, /image\.style\.top =/);
  assert.match(js, /panX \+ \(layer\.centerX - worldWidth \/ 2\) \* zoom/);
  assert.doesNotMatch(js, /camera\.style\.transform = `translate\(/);
  assert.match(js, /function alignmentMoveStep\(event\)/);
  assert.match(js, /if \(event\?\.altKey\) return 0\.25/);
  assert.match(js, /const amount = alignmentMoveStep\(event\)/);
  assert.doesNotMatch(js, /const amount = \(event\.shiftKey \? 10 : 1\) \/ alignmentState\.view\.zoom/);
  assert.match(js, /Math\.round\(layer\.centerX - layer\.width \/ 2\)/);
  assert.match(js, /function fitAlignmentView\(\)/);
  assert.match(js, /addEventListener\('wheel', onAlignmentWheel, \{ passive: false \}\)/);
  assert.match(js, /event\.button === 1 \|\| \(event\.button === 0 && alignmentState\.spacePressed\)/);
  assert.match(js, /const dx = \(event\.clientX - drag\.startX\) \/ alignmentState\.view\.zoom/);
  assert.match(js, /layer\.centerX = drag\.centerX \+ snapAlignmentDelta\(dx, event\)/);
  assert.match(js, /if \(\(artwork\.versions\?\.length \?\? 0\) > 1\)/);
  assert.match(js, /layer\.scale = control\.valueAsNumber/);
  assert.doesNotMatch(js, /layer\.initial\.scale \* control\.valueAsNumber/);
  assert.match(js, /reference\?\.explicit && geometry\.explicit/);
  assert.match(html, /Write anchors to source file/);
  assert.match(html, /Mouse wheel zooms around the pointer/);
  assert.match(html, /id="alignment-snap" checked/);
  assert.match(html, /Movement is independent of view zoom/);
  assert.match(html, /Pixel scale uses source-image pixels/);
  assert.match(css, /\.alignment-camera/);
  assert.match(css, /\.alignment-view-toolbar/);
  assert.match(css, /\.alignment-layer-frame/);
  assert.match(css, /\.alignment-layer-image/);
  assert.match(css, /image-rendering:\s*crisp-edges/);
  assert.match(css, /image-rendering:\s*pixelated/);
  assert.doesNotMatch(css, /\.alignment-camera\s*\{[\s\S]*?will-change:\s*transform/);
  assert.match(css, /\.alignment-control-grid/);
});

test('invalid artwork viewer anchors are reported and ignored', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.artworks[0].versions[0].media[0].viewerAnchor = {
    file: TWITTER_FILE,
    points: [{ x: 20, y: 20 }, { x: 20, y: 20 }]
  };
  const compilation = await compileArchive(source, { mediaRoot });
  assert.equal(compilation.manifest.media[MEDIA_ID].viewerAnchor, null);
  assert.equal(compilation.manifest.media[MEDIA_ID].viewerAlignment, null);
  assert.equal(compilation.issues.some((issue) => issue.code === 'media.viewer-anchor-invalid'), true);
});

test('invalid viewer anchor orientation fields are reported and ignored', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.artworks[0].versions[0].media[0].viewerAnchor = {
    file: TWITTER_FILE,
    flipX: 'yes',
    rotation: '180',
    points: [{ x: 20, y: 30 }, { x: 200, y: 220 }]
  };
  const compilation = await compileArchive(source, { mediaRoot });
  assert.equal(compilation.manifest.media[MEDIA_ID].viewerAnchor, null);
  assert.equal(compilation.manifest.media[MEDIA_ID].viewerAlignment, null);
  const issue = compilation.issues.find((item) => item.code === 'media.viewer-anchor-invalid');
  assert.ok(issue);
  assert.ok(issue.details.some((detail) => detail.includes('flipX')));
  assert.ok(issue.details.some((detail) => detail.includes('rotation')));
});

test('MediaViewer uses full hoverable side navigation zones, human dates, inactive current posts, and two-point artwork registration', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  const unsourcedFile = 'pixiv/unsourced.png';
  await fs.writeFile(path.join(mediaRoot, unsourcedFile), fakePng(320, 320, 5));
  source.artworks[0].versions[0].media.push({
    id: 'artwork-0001/v01/m02',
    files: [unsourcedFile]
  });
  const compilation = await compileArchive(source, { mediaRoot });
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-viewer-ui-'));
  await buildStaticSite(compilation, source, output, { mediaRoot });

  const js = await fs.readFile(path.join(output, 'assets', 'media-viewer-adapter.js'), 'utf8');
  const css = await fs.readFile(path.join(output, 'assets', 'archive.css'), 'utf8');
  const viewerIndex = JSON.parse(await fs.readFile(path.join(output, 'data', 'viewer-index.json'), 'utf8'));
  const artworkHtml = await fs.readFile(path.join(output, 'en', 'artworks', compilation.manifest.artworks[0].slug, 'index.html'), 'utf8');
  assert.match(js, /event\.clientX < mediaRect\.left && this\.prev/);
  assert.match(js, /event\.clientX > mediaRect\.right && this\.next/);
  assert.doesNotMatch(js, /image\.addEventListener\('click',[^\n]*viewer\.close/);
  assert.match(js, /media-viewer-switcher-preview/);
  assert.match(js, /pointerdown/);
  assert.match(js, /pointerType !== 'touch'/);
  assert.match(js, /edgeGuard = 28/);
  assert.match(js, /new Intl\.DateTimeFormat\(language/);
  assert.match(js, /aria-current', 'page'/);
  assert.match(js, /list\.childElementCount === 0/);
  assert.match(js, /media-viewer-post-link is-empty/);
  assert.match(js, /reference\.span \/ item\.geometry\.span/);
  assert.match(js, /unionWidth/);
  assert.match(js, /function orientationMatrix\(flipX = false, rotation = 0\)/);
  assert.match(js, /flipX \+ 180deg equals flipY/);
  assert.match(js, /for \(const corner of item\.geometry\.corners\)/);
  assert.match(js, /media\.style\.transform = `matrix\(/);
  assert.match(js, /width \/ 2, y: 0/);
  assert.match(js, /width \/ 2, y: height/);
  assert.match(css, /\.modal\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /\.modal-subtext\s*\{[\s\S]*?max-height:\s*min\(24dvh, 12rem\)[\s\S]*?overflow:\s*auto/);
  assert.match(js, /const leftSpace = Math\.max\(0, rect\.left\)/);
  assert.match(js, /const rightSpace = Math\.max\(0, window\.innerWidth - rect\.right\)/);
  assert.match(js, /switcher\?\.style\.removeProperty\('width'\)/);
  assert.match(css, /\.media-viewer-switcher\s*\{[\s\S]*?position:\s*fixed[\s\S]*?width:\s*0[\s\S]*?height:\s*100dvh/);
  assert.match(css, /\.media-viewer-switcher-left:hover[\s\S]*?linear-gradient/);
  assert.match(css, /\.media-viewer-switcher-right:hover[\s\S]*?linear-gradient/);
  assert.match(css, /\.media-viewer-switcher-preview\s*\{[\s\S]*?height:\s*clamp\(110px, 26vh, 270px\)/);
  assert.match(css, /\.media-viewer-post-link\.is-current/);
  assert.match(css, /\.media-viewer-post-list\s*\{[\s\S]*?flex-wrap:\s*nowrap[\s\S]*?height:\s*2rem/);
  assert.match(css, /\.media-viewer-post-link\.is-empty/);
  assert.equal(viewerIndex.viewerStrings.en.noKnownPosts, 'No known posts use this image.');
  assert.match(artworkHtml, /No known posts use this image\./);
});

test('orphan Twitter media with a decodable media timestamp is shown as an approximate lost post', async () => {
  const mediaRoot = await createMediaFixture();
  await fs.mkdir(path.join(mediaRoot, 'other'), { recursive: true });
  await fs.writeFile(path.join(mediaRoot, ORPHAN_TWITTER_FILE), fakePng(1200, 800, 3));
  await fs.writeFile(path.join(mediaRoot, UNKNOWN_OTHER_FILE), fakePng(1200, 800, 4));

  const source = fixtureSource();
  source.site.mediaDirectories = ['twitter', 'pixiv', 'other'];
  source.artworks.push(
    {
      id: 'artwork-orphan-twitter',
      title: { en: 'Recovered Twitter media' },
      versions: [{
        id: 'v01',
        scope: 'top',
        media: [{ id: 'artwork-orphan-twitter/v01/m01', files: [ORPHAN_TWITTER_FILE] }]
      }],
      __source: '/source/artworks/orphan-twitter.jsonc'
    },
    {
      id: 'artwork-unknown-platform',
      title: { en: 'Unknown platform media' },
      versions: [{
        id: 'v01',
        scope: 'top',
        media: [{ id: 'artwork-unknown-platform/v01/m01', files: [UNKNOWN_OTHER_FILE] }]
      }],
      __source: '/source/artworks/unknown-platform.jsonc'
    }
  );

  const compilation = await compileArchive(source, { mediaRoot });
  const recovered = compilation.manifest.posts.filter((post) => post.recovery?.kind === 'media-only');
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].key, 'twitter:lost-COJhPv9UsAAvk7w');
  assert.equal(recovered[0].platform, 'twitter');
  assert.equal(recovered[0].status, 'lost');
  assert.equal(recovered[0].publishedAt, '2015-09-05T15:13:43.870Z');
  assert.equal(recovered[0].dateApproximate, true);
  assert.equal(recovered[0].href, null);
  assert.deepEqual(recovered[0].mediaFiles, [ORPHAN_TWITTER_FILE]);
  assert.equal(recovered[0].recovery.dateSource, 'twitter-media-id');
  assert.deepEqual(recovered[0].recovery.sourceMediaIds, ['COJhPv9UsAAvk7w']);
  assert.equal(compilation.manifest.posts.some((post) => post.mediaFiles?.includes(UNKNOWN_OTHER_FILE)), false);
  assert.equal(
    compilation.issues.some((issue) => issue.code === 'file.unassigned-to-post' && issue.entityId === ORPHAN_TWITTER_FILE),
    false
  );
  assert.equal(
    compilation.issues.some((issue) => issue.code === 'file.unassigned-to-post' && issue.entityId === UNKNOWN_OTHER_FILE),
    true
  );

  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-lost-twitter-'));
  await buildStaticSite(compilation, source, output, { mediaRoot });
  const twitterHtml = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'twitter', 'index.html'), 'utf8');
  assert.match(twitterHtml, /compact-post--twitter compact-post--lost/);
  assert.match(twitterHtml, /compact-lost-badge">Lost</);
  assert.match(twitterHtml, /lost-COJhPv9UsAAvk7w/);

  const detailHtml = await fs.readFile(path.join(output, 'en', 'posts', 'twitter', 'lost-COJhPv9UsAAvk7w', 'index.html'), 'utf8');
  assert.match(detailHtml, /status status-lost">Lost</);
  assert.match(detailHtml, /≈ September 5, 2015/);
  assert.match(detailHtml, /The post itself was not preserved; only its images remain/);
  assert.doesNotMatch(detailHtml, /twitter\.com\/stairs2line\/status\/lost-/);
});

test('orphan Twitter media are grouped across artworks only when their upload timestamps fit one minute', async () => {
  const mediaRoot = await createMediaFixture();
  const timestamps = [
    '2015-09-05T15:10:00.000Z',
    '2015-09-05T15:10:50.000Z',
    '2015-09-05T15:11:40.000Z'
  ];
  const orphanFiles = timestamps.map((timestamp, index) =>
    `twitter/${twitterMediaIdAt(timestamp, index + 1)}.png`
  );
  for (let index = 0; index < orphanFiles.length; index += 1) {
    await fs.writeFile(path.join(mediaRoot, orphanFiles[index]), fakePng(1200, 800, 20 + index));
  }

  const source = fixtureSource();
  source.artworks.push(...orphanFiles.map((filePath, index) => ({
    id: `artwork-cluster-${index + 1}`,
    title: { en: `Cluster media ${index + 1}` },
    versions: [{
      id: `v0${index + 1}`,
      scope: 'top',
      media: [{ id: `artwork-cluster-${index + 1}/v0${index + 1}/m01`, files: [filePath] }]
    }],
    __source: `/source/artworks/cluster-${index + 1}.jsonc`
  })));

  const compilation = await compileArchive(source, { mediaRoot });
  const recovered = compilation.manifest.posts
    .filter((post) => post.recovery?.kind === 'media-only')
    .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));

  assert.equal(recovered.length, 2);
  assert.deepEqual(recovered[0].mediaFiles, orphanFiles.slice(0, 2));
  assert.equal(recovered[0].publishedAt, timestamps[1]);
  assert.equal(recovered[0].recovery.groupingWindowSeconds, 60);
  assert.deepEqual(recovered[1].mediaFiles, orphanFiles.slice(2));
  assert.equal(recovered[1].publishedAt, timestamps[2]);
});

test('recovered Twitter media groups never exceed the four-image post limit', async () => {
  const mediaRoot = await createMediaFixture();
  const base = Date.parse('2015-09-05T16:00:00.000Z');
  const timestamps = Array.from({ length: 5 }, (_, index) => new Date(base + index * 1000).toISOString());
  const orphanFiles = timestamps.map((timestamp, index) =>
    `twitter/${twitterMediaIdAt(timestamp, 20 + index)}.png`
  );
  for (let index = 0; index < orphanFiles.length; index += 1) {
    await fs.writeFile(path.join(mediaRoot, orphanFiles[index]), fakePng(1200, 800, 30 + index));
  }

  const source = fixtureSource();
  source.artworks.push(...orphanFiles.map((filePath, index) => ({
    id: `artwork-limit-${index + 1}`,
    title: { en: `Limit media ${index + 1}` },
    versions: [{
      id: 'v01',
      scope: 'top',
      media: [{ id: `artwork-limit-${index + 1}/v01/m01`, files: [filePath] }]
    }],
    __source: `/source/artworks/limit-${index + 1}.jsonc`
  })));

  const compilation = await compileArchive(source, { mediaRoot });
  const recovered = compilation.manifest.posts
    .filter((post) => post.recovery?.kind === 'media-only')
    .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));

  assert.equal(recovered.length, 2);
  assert.equal(recovered[0].mediaFiles.length, 4);
  assert.equal(recovered[1].mediaFiles.length, 1);
});

test('media already linked to a known Twitter post is not duplicated as a recovered post', async () => {
  const mediaRoot = await createMediaFixture();
  await fs.writeFile(path.join(mediaRoot, ORPHAN_TWITTER_FILE), fakePng(1200, 800, 3));
  const source = fixtureSource();
  source.posts[0].versions[0].media = [ORPHAN_TWITTER_FILE];
  source.artworks[0].versions[0].media[0].files = [ORPHAN_TWITTER_FILE, PIXIV_FILE];

  const compilation = await compileArchive(source, { mediaRoot });
  assert.equal(compilation.manifest.posts.some((post) => post.recovery?.kind === 'media-only'), false);
});


test('canonical post status is top-level and Tumblr versions preserve reblog evidence', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.posts = [{
    key: 'tumblr:95168716109',
    platform: 'tumblr',
    id: '95168716109',
    status: 'deleted',
    publishedAt: '2014-08-19T06:00:15.000Z',
    versions: [{
      firstRebloggedAt: '2014-09-29T19:25:57.000Z',
      reblogs: [{ blog: 'tessreblawgs', id: '98743112708' }],
      originalLanguage: 'ja',
      description: { ja: 'むむむ' },
      media: [PIXIV_FILE]
    }],
    __source: '/source/posts/tumblr.jsonc'
  }];

  const compilation = await compileArchive(source, { mediaRoot });
  const post = compilation.manifest.posts[0];
  assert.equal(post.status, 'deleted');
  assert.equal(post.versions[0].status, 'deleted');
  assert.equal(post.versions[0].firstRebloggedAt, '2014-09-29T19:25:57.000Z');
  assert.deepEqual(post.versions[0].reblogs, [{
    blog: 'tessreblawgs',
    id: '98743112708',
    href: 'https://www.tumblr.com/tessreblawgs/98743112708'
  }]);
  assert.equal(post.versions[0].reblogEvidenceDefined, true);
  assert.equal(compilation.issues.some((issue) => issue.code === 'post.invalid-status'), false);

  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-tumblr-reblogs-'));
  await buildStaticSite(compilation, source, output, { mediaRoot });
  const detailHtml = await fs.readFile(path.join(output, 'en', 'posts', 'tumblr', '95168716109', 'index.html'), 'utf8');
  assert.match(detailHtml, /Earliest known reblog:/);
  assert.match(detailHtml, /September 29, 2014/);
  assert.match(detailHtml, /Preserved reblogs:/);
  assert.match(detailHtml, /https:\/\/www\.tumblr\.com\/tessreblawgs\/98743112708/);
  assert.match(detailHtml, />@tessreblawgs</);

  const schema = JSON.parse(await fs.readFile(new URL('../schemas/archive-source.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.$defs.postVersion.required, undefined);
  assert.deepEqual(schema.$defs.post.properties.status.enum, ['alive', 'deleted']);
  assert.deepEqual(schema.$defs.postVersion.properties.firstRebloggedAt.type, ['string', 'null']);
  assert.equal(schema.$defs.postVersion.properties.reblogs.items.$ref, '#/$defs/postReblog');
});

test('upgrade moves legacy per-version post status to the original post', () => {
  const source = fixtureSource();
  const upgraded = upgradeSourcePosts(source);
  assert.equal(upgraded.posts[0].status, 'alive');
  assert.equal(Object.hasOwn(upgraded.posts[0].versions[0], 'status'), false);
  assert.equal(upgraded.posts[1].status, 'alive');
  assert.equal(Object.hasOwn(upgraded.posts[1].versions[0], 'status'), false);
});
