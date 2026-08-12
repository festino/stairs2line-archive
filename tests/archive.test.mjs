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
      basePath: '/repo/',
      mediaBasePath: 'media/stairs2line/',
      defaultLanguage: 'ru',
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
        originalLanguage: 'ja',
        description: { ja: '説明' },
        media: ['artwork-0001/v01/m01'],
        legacyAutoLink: true,
        __source: '/source/posts/twitter.jsonc'
      },
      {
        key: 'pixiv:999',
        platform: 'pixiv',
        id: '999',
        status: 'alive',
        originalLanguage: 'ja',
        media: ['artwork-0001/v01/m01'],
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
                id: 'artwork-0001/v01/m01',
                files: ['pixiv/missing.png'],
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
  await fs.writeFile(path.join(root, 'twitter', '123456789012345678_ABCDEF123456789.png'), fakePng(400, 400, 100));
  await fs.writeFile(path.join(root, 'pixiv', '999_p0.png'), fakePng(400, 400, 10));
  return root;
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
  assert.equal(extractLegacyMediaId('twitter/123456789012345678_ABCDEF123456789.png'), 'ABCDEF123456789');
  assert.equal(extractLegacyMediaId('tumblr/92164287224_tumblr_n8x7q9MNVH1s4v84ho1_540.png'), 'n8x7q9MNVH1s4v84ho1_540');
  assert.equal(extractLegacyMediaId('pixiv/44930075_p0.png'), '44930075_p0');
  assert.equal(extractPostIdFromFile('other/sENMiFJpci.png', [
    { key: 'instagram:sENMiFJpci', platform: 'instagram', id: 'sENMiFJpci' }
  ]), 'instagram:sENMiFJpci');
});

test('compiler selects the smallest existing equivalent file and tolerates missing candidates', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  const compilation = await compileArchive(source, { mediaRoot });
  const media = compilation.manifest.media['artwork-0001/v01/m01'];

  assert.equal(media.displayFile, 'pixiv/999_p0.png');
  assert.deepEqual(media.existingFiles.sort(), [
    'pixiv/999_p0.png',
    'twitter/123456789012345678_ABCDEF123456789.png'
  ]);
  assert.equal(compilation.issues.some((issue) => issue.code === 'media.no-existing-file'), false);
  assert.equal(compilation.issues.some((issue) => issue.code === 'media.some-files-missing'), true);
});


test('resolve step writes exact files and auto-links posts through the catalog', async () => {
  const mediaRoot = await createMediaFixture();
  const source = fixtureSource();
  source.posts[0].media = [];
  const knownPostIds = source.posts.map((post) => ({ key: post.key, platform: post.platform, id: post.id }));
  const catalog = await buildFileCatalog(mediaRoot, {
    includeDirectories: source.site.mediaDirectories,
    knownPostIds
  });
  resolveSourceFiles(source, catalog);
  const media = source.artworks[0].versions[0].media[0];
  assert.equal(media.files[0], 'pixiv/999_p0.png');
  assert.ok(media.files.includes('twitter/123456789012345678_ABCDEF123456789.png'));
  assert.deepEqual(source.posts[0].media, ['artwork-0001/v01/m01']);
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

test('static pages contain media in HTML and expose paged/feed controls', async () => {
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

  const html = await fs.readFile(path.join(output, 'ru', 'artworks', 'index.html'), 'utf8');
  assert.match(html, /<img[^>]+src="\/repo\/media\/stairs2line\/pixiv\/999_p0\.png"/);
  assert.match(html, /data-feed-toggle/);
  assert.match(html, /data-paged-list/);
  assert.match(html, /href="\/repo\/ru\/artworks\/oldest\/"/);
});
