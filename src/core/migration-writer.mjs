import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_LOCALES, DEFAULT_PLATFORMS, DEFAULT_SITE } from './default-data.mjs';
import { writeJson } from './jsonc.mjs';
import { chunk, ensureDirectory } from './util.mjs';

function publicPost(post) {
  const { key, ...rest } = post;
  return { key, ...rest };
}

export async function writeMigratedSource(outputRoot, migration) {
  await fs.rm(outputRoot, { recursive: true, force: true });
  await ensureDirectory(path.join(outputRoot, 'posts'));
  await ensureDirectory(path.join(outputRoot, 'artworks'));
  await ensureDirectory(path.join(outputRoot, 'locales'));

  await writeJson(
    path.join(outputRoot, 'site.jsonc'),
    DEFAULT_SITE,
    'Human-editable archive configuration. Code comments must remain in English.'
  );
  await writeJson(
    path.join(outputRoot, 'platforms.jsonc'),
    DEFAULT_PLATFORMS,
    'Platform URL templates and icons.'
  );

  for (const [language, locale] of Object.entries(DEFAULT_LOCALES)) {
    await writeJson(path.join(outputRoot, 'locales', `${language}.jsonc`), locale, `User interface strings for ${language}.`);
  }

  const postsByPlatform = Map.groupBy(migration.posts, (post) => post.platform);
  for (const [platform, posts] of postsByPlatform.entries()) {
    await writeJson(
      path.join(outputRoot, 'posts', `${platform}.jsonc`),
      { posts: posts.map(publicPost) },
      `Migrated ${platform} posts. Status is stored on every post.`
    );
  }

  for (const [index, artworkChunk] of chunk(migration.artworks, 40).entries()) {
    const first = index * 40 + 1;
    const last = first + artworkChunk.length - 1;
    await writeJson(
      path.join(outputRoot, 'artworks', `${String(first).padStart(4, '0')}-${String(last).padStart(4, '0')}.jsonc`),
      { artworks: artworkChunk },
      'Migrated artwork groups. Legacy media IDs are resolved to physical files during the resolve step.'
    );
  }

  await writeJson(
    path.join(outputRoot, 'migration-report.json'),
    migration.report,
    'Migration diagnostics and inferred post-to-media relationships.'
  );
}
