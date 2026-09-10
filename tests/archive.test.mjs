import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileArchive, resolveSourceFiles } from '../src/core/compiler.mjs';
import { DEFAULT_LOCALES } from '../src/core/default-data.mjs';
import { buildFileCatalog, extractLegacyMediaId, extractPostIdFromFile } from '../src/core/file-catalog.mjs';
import { parseLegacyArchive } from '../src/core/legacy-parser.mjs';
import { buildStaticSite } from '../src/core/site-builder.mjs';

const TWITTER_FILE = 'twitter/123456789012345678_ABCDEF123456789.png';
const PIXIV_FILE = 'pixiv/999_p0.png';
const MISSING_FILE = 'pixiv/missing.png';
const MEDIA_ID = 'artwork-0001/v01/m01';
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
          postUrlTemplate: 'https://twitter.com/{account}/status/{id}'
        },
        {
          id: 'pixiv',
          label: { default: 'pixiv' },
          postUrlTemplate: 'https://www.pixiv.net/artworks/{id}'
        },
        {
          id: 'tumblr',
          label: { default: 'Tumblr' },
          defaultAccount: 'stairs2line',
          postUrlTemplate: 'https://{account}.tumblr.com/post/{id}'
        }
      ]
    },
    locales: DEFAULT_LOCALES,
    posts: [
      {
        key: 'twitter:123456789012345678',
        platform: 'twitter',
        id: '123456789012345678',
        publishedAt: '2020-01-01T00:00:00Z',
        versions: [
          {
            status: 'alive',
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
        versions: [
          {
            status: 'alive',
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
    publishedAt: `2024-01-0${count}T00:00:00Z`,
    versions: [{
      status: 'alive',
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
});

test('post versions keep mutable fields and layout independent', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.posts = [
    {
      key: 'tumblr:42',
      platform: 'tumblr',
      id: '42',
      publishedAt: '2020-02-01T00:00:00Z',
      versions: [
        {
          status: 'alive',
          title: { en: 'First' },
          media: [TWITTER_FILE]
        },
        {
          status: 'deleted',
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
  assert.match(twitterHtml, /<img[^>]+data-file-path="twitter\/123456789012345678_ABCDEF123456789\.png"[^>]+src="\/repo\/media\/stairs2line\/pixiv\/999_p0\.png"/);
  assert.match(twitterHtml, /post-media-count-1 twitter-single-media--natural/);

  const twitterCompactHtml = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'twitter', 'compact', 'index.html'), 'utf8');
  assert.match(twitterCompactHtml, /<img src="\/repo\/media\/stairs2line\/pixiv\/999_p0\.png"/);

  const postsHtml = await fs.readFile(path.join(output, 'en', 'posts', 'index.html'), 'utf8');
  assert.doesNotMatch(postsHtml, /<body class="platform-page/);

  const archiveCss = await fs.readFile(path.join(output, 'assets', 'archive.css'), 'utf8');
  assert.match(archiveCss, /\.platform-page--pixiv \.post-card--pixiv[\s\S]*?max-height:\s*min\(85dvh, 1000px\)/);
  assert.doesNotMatch(archiveCss, /^\.post-card--(?:pixiv|twitter|tumblr)\s*\{/m);
});


test('twitter full view derives 1-4 image layouts from media count without a layout field', async () => {
  const mediaRoot = await createTwitterLayoutMediaFixture();
  const source = twitterLayoutSource();
  const compilation = await compileArchive(source, { mediaRoot });
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'stairs2line-twitter-layout-site-'));
  await buildStaticSite(compilation, source, output, { mediaRoot, copyMedia: true });

  const twitterHtml = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'twitter', 'index.html'), 'utf8');
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
    const twitterHtml = await fs.readFile(path.join(output, 'en', 'posts', 'platform', 'twitter', 'index.html'), 'utf8');
    assert.match(twitterHtml, new RegExp(`post-media-count-1 ${expected}`));
  }
});
