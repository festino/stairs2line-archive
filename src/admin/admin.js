(() => {
  const TWITTER_EPOCH_MS = 1288834974657n;
  let data = null;
  let languages = ['ru', 'en', 'ja'];

  function byId(id) {
    return document.getElementById(id);
  }

  function localizedInputs(containerName) {
    return Object.fromEntries(languages.map((language) => {
      const input = document.querySelector(`[data-language-fields="${containerName}"] [data-language="${language}"]`);
      return [language, input?.value.trim() || null];
    }).filter(([, value]) => value));
  }

  function setLocalizedInputs(containerName, value = {}) {
    for (const language of languages) {
      const input = document.querySelector(`[data-language-fields="${containerName}"] [data-language="${language}"]`);
      if (input) input.value = value?.[language] ?? '';
    }
  }

  function createLanguageFields() {
    document.querySelectorAll('[data-language-fields]').forEach((fieldset) => {
      for (const language of languages) {
        const label = document.createElement('label');
        label.textContent = language.toUpperCase();
        const input = document.createElement(fieldset.dataset.languageFields.includes('description') ? 'textarea' : 'input');
        input.dataset.language = language;
        if (input.tagName === 'TEXTAREA') input.rows = 4;
        label.append(input);
        fieldset.append(label);
      }
    });
  }

  function showTab(name) {
    document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
    document.querySelectorAll('[data-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
  }

  function twitterPostDate(id) {
    try {
      const value = (BigInt(id) >> 22n) + TWITTER_EPOCH_MS;
      return new Date(Number(value)).toISOString();
    } catch {
      return null;
    }
  }

  function twitterMediaDate(id) {
    try {
      let base64 = id.replaceAll('-', '+').replaceAll('_', '/');
      while (base64.length % 4 !== 0) base64 += '=';
      const raw = atob(base64);
      if (raw.length < 8) return null;
      let value = 0n;
      for (let index = 0; index < 8; index += 1) value = (value << 8n) | BigInt(raw.charCodeAt(index));
      return new Date(Number((value >> 22n) + TWITTER_EPOCH_MS)).toISOString();
    } catch {
      return null;
    }
  }

  function renderValidation() {
    const errors = data.issues.filter((issue) => issue.severity === 'error');
    const warnings = data.issues.filter((issue) => issue.severity === 'warning');
    byId('validation-summary').textContent = `${errors.length} errors, ${warnings.length} warnings`;
    byId('validation-list').innerHTML = data.issues.map((issue) => `
      <article class="issue issue-${issue.severity}">
        <strong>${issue.severity.toUpperCase()} · ${issue.code}</strong>
        <div>${issue.entityType}: <code>${issue.entityId}</code></div>
        ${issue.source ? `<div>Source: <code>${issue.source}</code></div>` : ''}
        ${issue.missing ? `<pre>${JSON.stringify(issue.missing, null, 2)}</pre>` : ''}
        ${issue.details ? `<pre>${JSON.stringify(issue.details, null, 2)}</pre>` : ''}
      </article>`).join('');
  }

  function populateEntitySelectors() {
    for (const post of data.posts) {
      const option = document.createElement('option');
      option.value = post.key;
      option.textContent = post.key;
      byId('post-existing').append(option);
    }
    for (const artwork of data.artworks) {
      const option = document.createElement('option');
      option.value = artwork.id;
      option.textContent = artwork.id;
      byId('artwork-existing').append(option);
    }
  }

  function loadPost(key) {
    const post = data.posts.find((item) => item.key === key);
    byId('post-platform').value = post?.platform ?? '';
    byId('post-id').value = post?.id ?? '';
    byId('post-account').value = post?.account ?? '';
    byId('post-status').value = post?.declaredStatus ?? post?.status ?? 'alive';
    byId('post-date').value = post?.publishedAt ?? '';
    byId('post-href').value = post?.href ?? '';
    byId('post-media').value = post?.mediaIds?.join('\n') ?? '';
    setLocalizedInputs('post-title', post?.title);
    setLocalizedInputs('post-description', post?.description);
  }

  function loadArtwork(id) {
    const artwork = data.artworks.find((item) => item.id === id);
    byId('artwork-id').value = artwork?.id ?? '';
    byId('artwork-slug').value = artwork?.slug ?? '';
    setLocalizedInputs('artwork-title', artwork?.title);
    setLocalizedInputs('artwork-description', artwork?.description);
    byId('artwork-versions').value = JSON.stringify(artwork?.versions?.map((version) => ({
      id: version.id,
      scope: version.scope,
      createdAt: version.createdAt || undefined,
      knownNotAfter: version.knownNotAfter || undefined,
      media: version.mediaIds.map((mediaId) => {
        const media = data.media[mediaId];
        return {
          id: mediaId,
          files: media?.declaredFiles ?? media?.existingFiles ?? [],
          legacyIds: media?.legacyIds ?? []
        };
      })
    })) ?? [{ id: 'v01', scope: 'major', media: [{ id: '', files: [] }] }], null, 2);
  }

  function generatePost(event) {
    event.preventDefault();
    const platform = byId('post-platform').value.trim();
    const id = byId('post-id').value.trim();
    const publishedAt = byId('post-date').value.trim() || (platform === 'twitter' ? twitterPostDate(id) : null);
    const result = {
      key: `${platform}:${id}`,
      platform,
      id,
      account: byId('post-account').value.trim() || undefined,
      status: byId('post-status').value,
      publishedAt: publishedAt || undefined,
      href: byId('post-href').value.trim() || undefined,
      originalLanguage: 'ja',
      title: localizedInputs('post-title'),
      description: localizedInputs('post-description'),
      media: byId('post-media').value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
    };
    byId('post-output').textContent = JSON.stringify(result, null, 2);
  }

  function generateArtwork(event) {
    event.preventDefault();
    let versions;
    try {
      versions = JSON.parse(byId('artwork-versions').value);
    } catch (error) {
      byId('artwork-output').textContent = `Invalid versions JSON: ${error.message}`;
      return;
    }
    const result = {
      id: byId('artwork-id').value.trim(),
      slug: byId('artwork-slug').value.trim() || undefined,
      title: localizedInputs('artwork-title'),
      description: localizedInputs('artwork-description'),
      versions
    };
    byId('artwork-output').textContent = JSON.stringify(result, null, 2);
  }

  function downloadOutput(outputId) {
    const text = byId(outputId).textContent;
    if (!text) return;
    const blob = new Blob([`${text}\n`], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${outputId.replace('-output', '')}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function renderMedia(filter = '') {
    const query = filter.toLowerCase();
    const items = Object.values(data.media).filter((media) => JSON.stringify(media).toLowerCase().includes(query));
    byId('media-list').innerHTML = items.slice(0, 500).map((media) => `
      <article class="media-row">
        <strong><code>${media.id}</code></strong>
        <div>Artwork: <code>${media.artworkId}/${media.versionId}</code></div>
        <div>Display: <code>${media.displayFile ?? 'unresolved'}</code></div>
        <div>Existing files: ${media.existingFiles?.length ?? 0}</div>
        <div>Missing candidates: ${(media.missingFiles?.length ?? 0) + (media.unresolvedLegacyIds?.length ?? 0)}</div>
        <div>Posts: ${(media.postIds ?? []).map((value) => `<code>${value}</code>`).join(', ') || 'none'}</div>
      </article>`).join('');
  }

  function extractDates(event) {
    event.preventDefault();
    const postId = byId('twitter-post-id').value.trim();
    const mediaId = byId('twitter-media-id').value.trim();
    byId('date-output').textContent = JSON.stringify({
      postId: postId || undefined,
      postPublishedAt: postId ? twitterPostDate(postId) : undefined,
      mediaId: mediaId || undefined,
      mediaUploadedAt: mediaId ? twitterMediaDate(mediaId) : undefined
    }, null, 2);
  }

  async function initialize() {
    const response = await fetch('../data/admin-data.json');
    if (!response.ok) throw new Error(`Could not load admin data: HTTP ${response.status}`);
    data = await response.json();
    languages = data.site.languages ?? languages;
    createLanguageFields();
    renderValidation();
    populateEntitySelectors();
    renderMedia();

    document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));
    byId('post-existing').addEventListener('change', (event) => loadPost(event.target.value));
    byId('artwork-existing').addEventListener('change', (event) => loadArtwork(event.target.value));
    byId('post-form').addEventListener('submit', generatePost);
    byId('artwork-form').addEventListener('submit', generateArtwork);
    byId('date-form').addEventListener('submit', extractDates);
    byId('media-filter').addEventListener('input', (event) => renderMedia(event.target.value));
    document.querySelectorAll('[data-download]').forEach((button) => button.addEventListener('click', () => downloadOutput(button.dataset.download)));
  }

  initialize().catch((error) => {
    document.body.insertAdjacentHTML('afterbegin', `<pre>${error.stack}</pre>`);
  });
})();
