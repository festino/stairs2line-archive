import fs from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeUnixTime, toDateOnly, twitterMediaDate, twitterPostDate } from './dates.mjs';
import { compactObject, unique } from './util.mjs';

function extractInitializer(source, name) {
  const marker = `const ${name} =`;
  const declarationIndex = source.indexOf(marker);
  if (declarationIndex < 0) throw new Error(`Could not find ${name} in the legacy source.`);

  let start = declarationIndex + marker.length;
  while (/\s/.test(source[start])) start += 1;
  const opening = source[start];
  const closing = opening === '{' ? '}' : opening === '[' ? ']' : null;
  if (!closing) throw new Error(`Unsupported initializer for ${name}.`);

  let depth = 0;
  let quote = null;
  let inTemplate = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (inTemplate) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '`') inTemplate = false;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '`') {
      inTemplate = true;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error(`Unclosed initializer for ${name}.`);
}

function evaluateInitializer(source, name) {
  const initializer = extractInitializer(source, name);
  const context = vm.createContext({ Date });
  return vm.runInContext(`(${initializer})`, context, { timeout: 2000 });
}

function localized(value, language = 'ja') {
  if (value === undefined || value === null || value === '') return undefined;
  return { [language]: String(value) };
}

function postKey(platform, id) {
  return `${platform}:${id}`;
}

function inferPlatformForLegacyId(legacyId, postsByPlatformAndId) {
  const exactPlatforms = [];
  for (const [platform, postMap] of postsByPlatformAndId.entries()) {
    if (postMap.has(legacyId)) exactPlatforms.push(platform);
  }
  if (exactPlatforms.length === 1) return exactPlatforms[0];
  if (/^\d+(?:_p\d+|-\d+)$/.test(legacyId)) return 'pixiv';
  if (/^[A-Za-z0-9_-]{12,16}$/.test(legacyId) && twitterMediaDate(legacyId)) return 'twitter';
  if (/s4v84h/.test(legacyId) || /^inline_/.test(legacyId)) return 'tumblr';
  return null;
}

function inferPostsForLegacyId(legacyId, posts, postsByPlatformAndId) {
  const result = [];
  const platform = inferPlatformForLegacyId(legacyId, postsByPlatformAndId);

  for (const post of posts) {
    if (post.id === legacyId) result.push(post.key);
  }

  const pixivMatch = legacyId.match(/^(\d+)(?:_p\d+|-\d+)$/);
  if (pixivMatch) {
    const key = postKey('pixiv', pixivMatch[1]);
    if (posts.some((post) => post.key === key)) result.push(key);
  }

  if (platform === 'twitter') {
    const mediaDate = twitterMediaDate(legacyId);
    if (mediaDate) {
      const mediaTime = Date.parse(mediaDate);
      const candidates = posts
        .filter((post) => post.platform === 'twitter' && post.publishedAt)
        .map((post) => ({ post, delta: Date.parse(post.publishedAt) - mediaTime }))
        .filter((item) => item.delta >= 0 && item.delta <= 12 * 60 * 60 * 1000)
        .sort((a, b) => a.delta - b.delta);
      if (candidates[0]) result.push(candidates[0].post.key);
    }
  }

  return unique(result);
}

function pickArtworkText(linkedPosts) {
  const withTitles = linkedPosts.filter((post) => post.title?.ja);
  const preferredTitlePost = withTitles.find((post) => post.platform === 'pixiv') ?? withTitles[0];
  let title = preferredTitlePost?.title;

  if (!title) {
    const shortDescriptionPost = linkedPosts.find((post) => {
      const value = post.description?.ja;
      return value && !value.includes('\n') && value.length <= 50;
    });
    if (shortDescriptionPost) title = { ja: shortDescriptionPost.description.ja };
  }

  let descriptionCandidate = preferredTitlePost?.description?.ja;
  if (!descriptionCandidate && linkedPosts.length === 1) {
    descriptionCandidate = linkedPosts[0].description?.ja;
  }
  if (descriptionCandidate === title?.ja) descriptionCandidate = null;

  return compactObject({
    title,
    description: descriptionCandidate ? { ja: descriptionCandidate } : undefined
  });
}

export async function parseLegacyArchive(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  const platformsPosts = evaluateInitializer(source, 'platformsPosts');
  const mediaGroups = evaluateInitializer(source, 'mediaGroups');

  const posts = [];
  const postsByPlatformAndId = new Map();

  for (const [collectionPlatform, collection] of Object.entries(platformsPosts)) {
    for (const [legacyStatus, values] of [['alive', collection.alive ?? []], ['deleted', collection.dead ?? []]]) {
      for (const value of values) {
        const platform = value.platform ?? collectionPlatform;
        const id = String(value.post);
        const publishedAt = platform === 'twitter'
          ? twitterPostDate(id)
          : normalizeUnixTime(value.time);
        const post = compactObject({
          key: postKey(platform, id),
          platform,
          id,
          account: value.user,
          status: legacyStatus,
          publishedAt,
          href: value.href,
          originalLanguage: 'ja',
          title: localized(value.title),
          description: localized(value.description),
          legacyAutoLink: true
        });
        post.media = [];
        posts.push(post);
        if (!postsByPlatformAndId.has(platform)) postsByPlatformAndId.set(platform, new Map());
        postsByPlatformAndId.get(platform).set(id, post);
      }
    }
  }

  const postsByKey = new Map(posts.map((post) => [post.key, post]));
  const artworks = [];
  const inferredLinks = [];

  for (let groupIndex = 0; groupIndex < mediaGroups.length; groupIndex += 1) {
    const legacyGroup = mediaGroups[groupIndex];
    const artworkId = `artwork-${String(groupIndex + 1).padStart(4, '0')}`;
    const versions = [];
    const artworkPostKeys = new Set();

    for (let versionIndex = 0; versionIndex < legacyGroup.versions.length; versionIndex += 1) {
      const legacyVersion = legacyGroup.versions[versionIndex];
      const versionId = `v${String(versionIndex + 1).padStart(2, '0')}`;
      const mediaId = `${artworkId}/${versionId}/m01`;
      const versionPostKeys = new Set();

      for (const legacyId of legacyVersion.media) {
        for (const key of inferPostsForLegacyId(String(legacyId), posts, postsByPlatformAndId)) {
          versionPostKeys.add(key);
          artworkPostKeys.add(key);
          const post = postsByKey.get(key);
          if (post && !post.media.includes(mediaId)) post.media.push(mediaId);
          inferredLinks.push({ legacyId: String(legacyId), postKey: key, mediaId });
        }
      }

      const knownNotAfter = legacyVersion.time
        ? toDateOnly(normalizeUnixTime(legacyVersion.time))
        : undefined;

      versions.push(compactObject({
        id: versionId,
        scope: legacyVersion.scope,
        knownNotAfter,
        media: [{
          id: mediaId,
          files: [],
          legacyIds: legacyVersion.media.map(String)
        }],
        migration: {
          legacyVersionIndex: versionIndex + 1,
          inferredPostIds: [...versionPostKeys]
        }
      }));
    }

    const linkedPosts = [...artworkPostKeys].map((key) => postsByKey.get(key)).filter(Boolean);
    const inferredText = pickArtworkText(linkedPosts);
    artworks.push(compactObject({
      id: artworkId,
      ...inferredText,
      versions,
      migration: {
        legacyGroupIndex: groupIndex + 1,
        inferredPostIds: [...artworkPostKeys]
      }
    }));
  }

  return {
    posts,
    artworks,
    report: {
      postCount: posts.length,
      artworkCount: artworks.length,
      versionCount: artworks.reduce((sum, artwork) => sum + artwork.versions.length, 0),
      legacyMediaIdCount: artworks.reduce(
        (sum, artwork) => sum + artwork.versions.reduce(
          (versionSum, version) => versionSum + version.media.reduce(
            (mediaSum, media) => mediaSum + media.legacyIds.length,
            0
          ),
          0
        ),
        0
      ),
      inferredLinkCount: inferredLinks.length,
      inferredLinks
    }
  };
}
