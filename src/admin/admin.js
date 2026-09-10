(() => {
  const TWITTER_EPOCH_MS = 1288834974657n;
  let data = null;
  let languages = ['ru', 'en', 'ja'];
  const alignmentState = {
    artwork: null,
    layers: [],
    activeLayerId: null,
    drag: null,
    spacePressed: false,
    view: { zoom: 1, panX: 0, panY: 0 },
    sourceDirectoryHandle: null
  };
  const ALIGNMENT_MIN_ZOOM = 0.1;
  const ALIGNMENT_MAX_ZOOM = 12;

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
      // Media-only lost Twitter posts are derived during compilation and do
      // not have a source post object to edit.
      if (post.recovery?.kind === 'media-only') continue;
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

      if ((artwork.versions?.length ?? 0) > 1) {
        const alignmentOption = option.cloneNode(true);
        const alignmentTitle = artwork.title?.ja ?? artwork.title?.en ?? artwork.title?.default ?? Object.values(artwork.title ?? {}).find(Boolean);
        alignmentOption.textContent = alignmentTitle ? `${artwork.id} · ${alignmentTitle}` : artwork.id;
        byId('alignment-artwork').append(alignmentOption);
      }
    }
    for (const platform of data.platforms ?? []) {
      const option = document.createElement('option');
      option.value = platform.id;
      option.textContent = platform.id;
      byId('platform-existing').append(option);
    }
  }

  function loadPlatform(id) {
    const platform = data.platforms.find((item) => item.id === id);
    byId('platform-id').value = platform?.id ?? '';
    setLocalizedInputs('platform-label', platform?.label);
    byId('platform-default-account').value = platform?.defaultAccount ?? '';
    byId('platform-url-template').value = platform?.postUrlTemplate ?? '';
    byId('platform-icon').value = platform?.icon ?? '';
    byId('platform-versions').value = JSON.stringify(platform?.versions?.map((version) => ({
      observedAt: version.observedAt || undefined,
      account: version.account || undefined,
      description: version.description && Object.keys(version.description).length > 0 ? version.description : undefined,
      sourceUrl: version.sourceUrl || undefined,
      avatar: version.avatar === null ? null : (version.avatar || undefined),
      banner: version.banner === null ? null : (version.banner || undefined)
    })) ?? [{ account: platform?.defaultAccount || undefined }], null, 2);
  }

  function loadPost(key) {
    const post = data.posts.find((item) => item.key === key);
    byId('post-platform').value = post?.platform ?? '';
    byId('post-id').value = post?.id ?? '';
    byId('post-status').value = post?.declaredStatus ?? post?.status ?? 'alive';
    byId('post-date').value = post?.publishedAt ?? '';
    byId('post-versions').value = JSON.stringify(post?.versions?.map((version) => ({
      account: version.account || undefined,
      firstRebloggedAt: version.reblogEvidenceDefined ? (version.firstRebloggedAt ?? null) : undefined,
      reblogs: version.reblogEvidenceDefined ? (version.reblogs ?? []).map((reblog) => ({ blog: reblog.blog, id: reblog.id })) : undefined,
      href: version.href || undefined,
      originalLanguage: version.originalLanguage || undefined,
      title: version.title && Object.keys(version.title).length > 0 ? version.title : undefined,
      description: version.description && Object.keys(version.description).length > 0 ? version.description : undefined,
      media: version.mediaFiles ?? [],
      layout: version.layout || undefined
    })) ?? [{ originalLanguage: 'ja', media: [] }], null, 2);
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
          legacyIds: media?.legacyIds ?? [],
          viewerAnchor: media?.viewerAnchor ?? undefined
        };
      })
    })) ?? [{ id: 'v01', scope: 'major', media: [{ id: '', files: [] }] }], null, 2);
  }

  function generatePlatform(event) {
    event.preventDefault();
    let versions;
    try {
      versions = JSON.parse(byId('platform-versions').value);
      if (!Array.isArray(versions) || versions.length === 0) throw new Error('Versions must be a non-empty array.');
    } catch (error) {
      byId('platform-output').textContent = `Invalid versions JSON: ${error.message}`;
      return;
    }
    const result = {
      id: byId('platform-id').value.trim(),
      label: localizedInputs('platform-label'),
      defaultAccount: byId('platform-default-account').value.trim() || undefined,
      postUrlTemplate: byId('platform-url-template').value.trim() || undefined,
      icon: byId('platform-icon').value.trim() || undefined,
      versions
    };
    byId('platform-output').textContent = JSON.stringify(result, null, 2);
  }

  function generatePost(event) {
    event.preventDefault();
    const platform = byId('post-platform').value.trim();
    const id = byId('post-id').value.trim();
    const publishedAt = byId('post-date').value.trim() || (platform === 'twitter' ? twitterPostDate(id) : null);
    let versions;
    try {
      versions = JSON.parse(byId('post-versions').value);
      if (!Array.isArray(versions) || versions.length === 0) throw new Error('Versions must be a non-empty array.');
    } catch (error) {
      byId('post-output').textContent = `Invalid versions JSON: ${error.message}`;
      return;
    }
    const result = {
      key: `${platform}:${id}`,
      platform,
      id,
      status: byId('post-status').value,
      publishedAt: publishedAt || undefined,
      versions
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

  function escapeHtmlText(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function roundNumber(value, digits = 4) {
    const factor = 10 ** digits;
    const rounded = Math.round(value * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function normalizedRotation(value) {
    if (!Number.isFinite(value)) return 0;
    let result = value % 360;
    if (result <= -180) result += 360;
    if (result > 180) result -= 360;
    return Math.abs(result) < 1e-8 ? 0 : roundNumber(result, 4);
  }

  function alignmentOrientationMatrix(flipX = false, rotation = 0) {
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

  function orientAlignmentPoint(point, width, height, matrix) {
    const centerX = width / 2;
    const centerY = height / 2;
    const x = point.x - centerX;
    const y = point.y - centerY;
    return {
      x: centerX + matrix.a * x + matrix.c * y,
      y: centerY + matrix.b * x + matrix.d * y
    };
  }

  function alignmentAssetUrl(filePath) {
    const basePath = `/${String(data.site.basePath ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
    const mediaBasePath = String(data.site.mediaBasePath ?? 'media/stairs2line/').replace(/^\/+|\/+$/g, '');
    const cleanFilePath = String(filePath ?? '').replace(/^\/+/, '');
    return new URL(`${basePath}${mediaBasePath}/${cleanFilePath}`, window.location.origin).href;
  }

  function alignmentSourceFile(artworkId) {
    return data.artworkSourceFiles?.[artworkId] ?? null;
  }

  function setAlignmentStatus(message = '', kind = '') {
    const status = byId('alignment-status');
    status.textContent = message;
    status.classList.toggle('is-error', kind === 'error');
    status.classList.toggle('is-success', kind === 'success');
  }

  function clampAlignmentZoom(value) {
    return Math.min(ALIGNMENT_MAX_ZOOM, Math.max(ALIGNMENT_MIN_ZOOM, value));
  }

  function updateAlignmentView() {
    // Do not scale the camera element itself. Compositor-level transforms can
    // resample already-rasterized <img> layers and make pixel art look smooth
    // until some unrelated repaint (for example selecting the layer). Render
    // every image directly at its final on-screen size instead.
    const camera = byId('alignment-camera');
    if (camera) camera.style.removeProperty('transform');
    updateAlignmentImages();
    const output = byId('alignment-zoom-value');
    if (output) output.textContent = `${Math.round(alignmentState.view.zoom * 100)}%`;
    const zoomOut = byId('alignment-zoom-out');
    const zoomIn = byId('alignment-zoom-in');
    const zoomReset = byId('alignment-zoom-reset');
    const fit = byId('alignment-fit');
    if (zoomOut) zoomOut.disabled = alignmentState.layers.length === 0 || alignmentState.view.zoom <= ALIGNMENT_MIN_ZOOM + 1e-8;
    if (zoomIn) zoomIn.disabled = alignmentState.layers.length === 0 || alignmentState.view.zoom >= ALIGNMENT_MAX_ZOOM - 1e-8;
    if (zoomReset) zoomReset.disabled = alignmentState.layers.length === 0;
    if (fit) fit.disabled = alignmentState.layers.length === 0;
  }

  function resetAlignmentView() {
    alignmentState.view.zoom = 1;
    alignmentState.view.panX = 0;
    alignmentState.view.panY = 0;
    updateAlignmentView();
  }

  function setAlignmentZoom(nextZoom, focalX, focalY) {
    if (alignmentState.layers.length === 0) return;
    const stage = byId('alignment-stage');
    const rect = stage.getBoundingClientRect();
    const oldZoom = alignmentState.view.zoom;
    const zoom = clampAlignmentZoom(nextZoom);
    if (Math.abs(zoom - oldZoom) < 1e-10) return;
    const x = Number.isFinite(focalX) ? focalX : rect.width / 2;
    const y = Number.isFinite(focalY) ? focalY : rect.height / 2;
    const worldX = (x - alignmentState.view.panX) / oldZoom;
    const worldY = (y - alignmentState.view.panY) / oldZoom;
    alignmentState.view.zoom = zoom;
    alignmentState.view.panX = x - worldX * zoom;
    alignmentState.view.panY = y - worldY * zoom;
    updateAlignmentView();
  }

  function zoomAlignmentBy(factor, focalX, focalY) {
    setAlignmentZoom(alignmentState.view.zoom * factor, focalX, focalY);
  }

  function fitAlignmentView() {
    const stage = byId('alignment-stage');
    if (alignmentState.layers.length === 0) {
      resetAlignmentView();
      return;
    }
    const polygons = alignmentState.layers.flatMap((layer) => layerScreenPolygon(layer));
    if (polygons.length === 0) return;
    const left = Math.min(...polygons.map((point) => point.x));
    const top = Math.min(...polygons.map((point) => point.y));
    const right = Math.max(...polygons.map((point) => point.x));
    const bottom = Math.max(...polygons.map((point) => point.y));
    const unionWidth = Math.max(1, right - left);
    const unionHeight = Math.max(1, bottom - top);
    const rect = stage.getBoundingClientRect();
    const padding = 32;
    const zoom = clampAlignmentZoom(Math.min(
      Math.max(1, rect.width - padding * 2) / unionWidth,
      Math.max(1, rect.height - padding * 2) / unionHeight
    ));
    alignmentState.view.zoom = zoom;
    alignmentState.view.panX = (rect.width - unionWidth * zoom) / 2 - left * zoom;
    alignmentState.view.panY = (rect.height - unionHeight * zoom) / 2 - top * zoom;
    updateAlignmentView();
  }

  function onAlignmentWheel(event) {
    if (alignmentState.layers.length === 0) return;
    const stage = byId('alignment-stage');
    const rect = stage.getBoundingClientRect();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * rect.height : event.deltaY;
    const factor = Math.exp(-delta * 0.0015);
    zoomAlignmentBy(factor, event.clientX - rect.left, event.clientY - rect.top);
    event.preventDefault();
  }

  function firstDeclaredImage(media) {
    const filePath = media?.declaredFiles?.[0] ?? null;
    const file = filePath ? data.files?.[filePath] : null;
    if (!filePath || !file || !file.mimeType?.startsWith('image/') || !(file.width > 0) || !(file.height > 0)) return null;
    return { filePath, file };
  }

  function savedAlignmentGeometry(layer) {
    const { width, height, media, filePath } = layer;
    const anchor = media.viewerAnchor;
    const hasExplicitAnchor = anchor?.points?.length === 2;
    let points;
    if (hasExplicitAnchor) {
      const anchorFilePath = anchor.file ?? filePath;
      const anchorFile = data.files?.[anchorFilePath];
      if (anchorFile?.width > 0 && anchorFile?.height > 0) {
        points = anchor.points.map((point) => ({
          x: Number(point.x) * width / anchorFile.width,
          y: Number(point.y) * height / anchorFile.height
        }));
      }
    }
    const explicit = Boolean(points);
    points ??= [
      { x: width / 2, y: 0 },
      { x: width / 2, y: height }
    ];

    const flipX = anchor?.flipX === true;
    const rotation = Number.isFinite(anchor?.rotation) ? anchor.rotation : 0;
    const matrix = alignmentOrientationMatrix(flipX, rotation);
    const orientedPoints = points.map((point) => orientAlignmentPoint(point, width, height, matrix));
    const center = {
      x: (orientedPoints[0].x + orientedPoints[1].x) / 2,
      y: (orientedPoints[0].y + orientedPoints[1].y) / 2
    };
    const span = Math.hypot(
      orientedPoints[1].x - orientedPoints[0].x,
      orientedPoints[1].y - orientedPoints[0].y
    );
    const corners = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height }
    ].map((point) => orientAlignmentPoint(point, width, height, matrix));
    return { points: orientedPoints, center, span, corners, matrix, flipX, rotation, explicit };
  }

  function buildAlignmentLayers(artwork) {
    const layers = [];
    for (const [versionIndex, version] of artwork.versions.entries()) {
      for (const [mediaIndex, mediaId] of version.mediaIds.entries()) {
        const media = data.media[mediaId];
        const image = firstDeclaredImage(media);
        if (!image) continue;
        const saved = media.viewerAnchor ?? {};
        layers.push({
          id: `${version.id}:${mediaId}`,
          versionId: version.id,
          versionIndex,
          mediaIndex,
          mediaId,
          media,
          filePath: image.filePath,
          width: image.file.width,
          height: image.file.height,
          opacity: layers.length === 0 ? 1 : 0.55,
          flipX: saved.flipX === true,
          rotation: Number.isFinite(saved.rotation) ? saved.rotation : 0,
          centerX: 0,
          centerY: 0,
          scale: 1,
          initial: null
        });
      }
    }
    return layers;
  }

  function initializeAlignmentTransforms() {
    const stage = byId('alignment-stage');
    const layers = alignmentState.layers;
    if (layers.length === 0) return;
    const rect = stage.getBoundingClientRect();
    const stageWidth = Math.max(rect.width, 640);
    const stageHeight = Math.max(rect.height, 420);
    const sharedCenter = { x: stageWidth / 2, y: stageHeight / 2 };
    const geometries = layers.map((layer) => savedAlignmentGeometry(layer));
    const referenceIndex = Math.max(0, geometries.findIndex((geometry) => geometry.explicit && geometry.span > 0));
    const reference = geometries[referenceIndex];

    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      const geometry = geometries[index];
      // Layer scale is expressed directly in source-image pixels: 1 means one
      // source pixel has the same world-space size in every layer. Existing
      // anchors can restore relative scale, but unanchored layers start at 1.
      const scale = reference?.explicit && geometry.explicit && reference.span > 0 && geometry.span > 0
        ? reference.span / geometry.span
        : 1;
      const localAnchorX = geometry.center.x - layer.width / 2;
      const localAnchorY = geometry.center.y - layer.height / 2;
      layer.scale = scale;
      layer.centerX = sharedCenter.x - localAnchorX * scale;
      layer.centerY = sharedCenter.y - localAnchorY * scale;

      // With no saved registration, keep source-pixel boundaries on one
      // alignment-world pixel lattice. Previously every image shared exactly
      // the same centre, so odd/even source dimensions could start half a
      // pixel apart even at Pixel scale = 1.
      if (!reference?.explicit && !geometry.explicit && Math.abs(scale - 1) < 1e-8) {
        const left = Math.round(layer.centerX - layer.width / 2);
        const top = Math.round(layer.centerY - layer.height / 2);
        layer.centerX = left + layer.width / 2;
        layer.centerY = top + layer.height / 2;
      }
      layer.initial = {
        centerX: layer.centerX,
        centerY: layer.centerY,
        scale: layer.scale,
        flipX: layer.flipX,
        rotation: layer.rotation,
        opacity: layer.opacity
      };
    }
  }

  function alignmentLayerMatrix(layer) {
    return alignmentOrientationMatrix(layer.flipX, layer.rotation);
  }

  function updateAlignmentImages() {
    const { zoom, panX, panY } = alignmentState.view;
    for (const layer of alignmentState.layers) {
      const frame = byId(`alignment-frame-${layer.id}`);
      const image = byId(`alignment-image-${layer.id}`);
      if (!frame || !image) continue;
      const worldWidth = layer.width * layer.scale;
      const worldHeight = layer.height * layer.scale;
      const width = worldWidth * zoom;
      const height = worldHeight * zoom;
      const screenLeft = panX + (layer.centerX - worldWidth / 2) * zoom;
      const screenTop = panY + (layer.centerY - worldHeight / 2) * zoom;
      const matrix = alignmentLayerMatrix(layer);

      // Keep raster scaling on the <img> itself so nearest-neighbour sampling
      // stays stable, but move the layer with a compositor translation. CSS
      // left/top painting can quantize a pixelated image to device-pixel
      // thresholds, making e.g. 6.9px through 7.6px offsets look identical.
      // translate3d preserves the fractional screen position; camera zoom then
      // magnifies subpixel alignment differences instead of hiding them.
      frame.style.width = `${width}px`;
      frame.style.height = `${height}px`;
      frame.style.transform = `translate3d(${screenLeft}px, ${screenTop}px, 0)`;
      frame.style.opacity = String(layer.opacity);
      frame.style.zIndex = alignmentState.activeLayerId === layer.id ? '100' : String(layer.versionIndex + 1);

      image.style.width = '100%';
      image.style.height = '100%';
      image.style.imageRendering = 'pixelated';
      image.style.transform = `matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, 0, 0)`;
      image.classList.toggle('is-active', alignmentState.activeLayerId === layer.id);
    }
  }

  function layerScaleFactor(layer) {
    return layer.scale > 0 ? layer.scale : 1;
  }

  function renderAlignmentLayerControls() {
    const container = byId('alignment-layers');
    if (alignmentState.layers.length === 0) {
      container.innerHTML = '<p>No usable image layers. Every compared media item needs an existing first <code>files[]</code> image with known dimensions.</p>';
      return;
    }

    container.innerHTML = alignmentState.layers.map((layer) => {
      const active = alignmentState.activeLayerId === layer.id;
      const offsetX = layer.initial ? layer.centerX - layer.initial.centerX : 0;
      const offsetY = layer.initial ? layer.centerY - layer.initial.centerY : 0;
      return `<article class="alignment-layer-control${active ? ' is-active' : ''}" data-alignment-layer="${escapeHtmlText(layer.id)}">
        <label class="alignment-layer-select">
          <input type="radio" name="alignment-active-layer" value="${escapeHtmlText(layer.id)}"${active ? ' checked' : ''}>
          <span class="alignment-layer-title"><strong>${escapeHtmlText(layer.versionId)}${layer.mediaIndex > 0 ? ` · media ${layer.mediaIndex + 1}` : ''}</strong><code>${escapeHtmlText(layer.filePath)}</code></span>
        </label>
        <div class="alignment-control-grid">
          <label title="Alignment-world pixels; at Pixel scale 1 these equal source pixels">X offset px <input type="number" step="any" data-alignment-control="x" value="${roundNumber(offsetX, 2)}"></label>
          <label title="Alignment-world pixels; at Pixel scale 1 these equal source pixels">Y offset px <input type="number" step="any" data-alignment-control="y" value="${roundNumber(offsetY, 2)}"></label>
          <label title="1 = one source-image pixel per alignment-world pixel">Pixel scale × <input type="number" min="0.01" max="100" step="0.001" data-alignment-control="scale" value="${roundNumber(layerScaleFactor(layer), 4)}"></label>
          <label>Rotation ° <input type="number" step="0.25" data-alignment-control="rotation" value="${roundNumber(layer.rotation, 3)}"></label>
          <label class="wide">Opacity <input type="range" min="0" max="1" step="0.01" data-alignment-control="opacity" value="${layer.opacity}"></label>
          <label class="wide alignment-inline"><input type="checkbox" data-alignment-control="flipX"${layer.flipX ? ' checked' : ''}> Flip horizontally</label>
        </div>
        <div class="alignment-layer-actions">
          <button type="button" data-alignment-action="rotate-left">−90°</button>
          <button type="button" data-alignment-action="rotate-right">+90°</button>
          <button type="button" data-alignment-action="reset-layer">Reset layer</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderAlignmentStage() {
    const stage = byId('alignment-stage');
    if (alignmentState.layers.length === 0) {
      stage.innerHTML = '<div class="alignment-empty">Choose an artwork with at least two usable image versions.</div>';
      updateAlignmentView();
      return;
    }
    stage.innerHTML = `<div id="alignment-camera" class="alignment-camera">${alignmentState.layers.map((layer) => `
      <div id="alignment-frame-${escapeHtmlText(layer.id)}" class="alignment-layer-frame">
        <img id="alignment-image-${escapeHtmlText(layer.id)}" class="alignment-layer-image" src="${escapeHtmlText(alignmentAssetUrl(layer.filePath))}" width="${layer.width}" height="${layer.height}" alt="${escapeHtmlText(`${layer.versionId} · ${layer.filePath}`)}" draggable="false">
      </div>`).join('')}</div>`;
    updateAlignmentImages();
    updateAlignmentView();
  }

  function renderAlignmentEditor(artworkId) {
    const artwork = data.artworks.find((item) => item.id === artworkId) ?? null;
    alignmentState.artwork = artwork;
    alignmentState.layers = artwork ? buildAlignmentLayers(artwork) : [];
    alignmentState.activeLayerId = alignmentState.layers[0]?.id ?? null;
    alignmentState.drag = null;
    alignmentState.spacePressed = false;
    alignmentState.view = { zoom: 1, panX: 0, panY: 0 };

    const sourceFile = artwork ? alignmentSourceFile(artwork.id) : null;
    byId('alignment-source').textContent = sourceFile ? `Source: data/source/${sourceFile}` : '';
    byId('alignment-reset').disabled = alignmentState.layers.length === 0;
    byId('alignment-write').disabled = alignmentState.layers.length < 2 || !sourceFile;
    byId('alignment-output').textContent = '';
    setAlignmentStatus('');

    if (!artwork) {
      renderAlignmentStage();
      renderAlignmentLayerControls();
      return;
    }

    requestAnimationFrame(() => {
      initializeAlignmentTransforms();
      renderAlignmentStage();
      renderAlignmentLayerControls();
      fitAlignmentView();
      if (alignmentState.layers.length < 2) {
        setAlignmentStatus('This artwork has fewer than two usable image layers to compare.', 'error');
      } else {
        updateAlignmentPreviewOutput();
      }
    });
  }

  function alignmentLayerById(id) {
    return alignmentState.layers.find((layer) => layer.id === id) ?? null;
  }

  function setActiveAlignmentLayer(id) {
    if (!alignmentLayerById(id)) return;
    alignmentState.activeLayerId = id;
    renderAlignmentLayerControls();
    updateAlignmentImages();
    byId('alignment-stage').focus({ preventScroll: true });
  }

  function resetAlignmentLayer(layer) {
    if (!layer?.initial) return;
    Object.assign(layer, {
      centerX: layer.initial.centerX,
      centerY: layer.initial.centerY,
      scale: layer.initial.scale,
      flipX: layer.initial.flipX,
      rotation: layer.initial.rotation,
      opacity: layer.initial.opacity
    });
  }

  function onAlignmentLayerInput(event) {
    const control = event.target.closest('[data-alignment-control]');
    if (!control) return;
    const row = control.closest('[data-alignment-layer]');
    const layer = alignmentLayerById(row?.dataset.alignmentLayer);
    if (!layer) return;
    const kind = control.dataset.alignmentControl;
    if (kind === 'x' && Number.isFinite(control.valueAsNumber)) layer.centerX = layer.initial.centerX + control.valueAsNumber;
    else if (kind === 'y' && Number.isFinite(control.valueAsNumber)) layer.centerY = layer.initial.centerY + control.valueAsNumber;
    else if (kind === 'scale' && Number.isFinite(control.valueAsNumber) && control.valueAsNumber > 0) layer.scale = control.valueAsNumber;
    else if (kind === 'rotation' && Number.isFinite(control.valueAsNumber)) layer.rotation = control.valueAsNumber;
    else if (kind === 'opacity' && Number.isFinite(control.valueAsNumber)) layer.opacity = control.valueAsNumber;
    else if (kind === 'flipX') layer.flipX = control.checked;
    updateAlignmentImages();
    updateAlignmentPreviewOutput();
  }

  function onAlignmentLayerClick(event) {
    const radio = event.target.closest('input[name="alignment-active-layer"]');
    if (radio) {
      setActiveAlignmentLayer(radio.value);
      return;
    }

    const button = event.target.closest('[data-alignment-action]');
    if (!button) return;
    const row = button.closest('[data-alignment-layer]');
    const layer = alignmentLayerById(row?.dataset.alignmentLayer);
    if (!layer) return;
    if (button.dataset.alignmentAction === 'rotate-left') layer.rotation -= 90;
    else if (button.dataset.alignmentAction === 'rotate-right') layer.rotation += 90;
    else if (button.dataset.alignmentAction === 'reset-layer') resetAlignmentLayer(layer);
    renderAlignmentLayerControls();
    updateAlignmentImages();
    updateAlignmentPreviewOutput();
  }

  function onAlignmentPointerDown(event) {
    const stage = byId('alignment-stage');
    const wantsPan = event.button === 1 || (event.button === 0 && alignmentState.spacePressed);
    if (wantsPan) {
      alignmentState.drag = {
        kind: 'pan',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        panX: alignmentState.view.panX,
        panY: alignmentState.view.panY
      };
      stage.classList.add('is-panning');
      stage.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    if (event.button !== 0) return;
    const layer = alignmentLayerById(alignmentState.activeLayerId);
    if (!layer) return;
    alignmentState.drag = {
      kind: 'layer',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerX: layer.centerX,
      centerY: layer.centerY
    };
    stage.classList.add('is-dragging');
    stage.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function alignmentMoveStep(event) {
    // Offsets live in alignment-world pixels. At Pixel scale = 1 this is
    // exactly one source pixel and, unlike the old behaviour, it must not
    // change when the camera is zoomed. Alt provides a deliberate subpixel
    // step for non-pixel-art registration.
    if (event?.altKey) return 0.25;
    if (event?.shiftKey) return 10;
    return 1;
  }

  function snapAlignmentDelta(value, event) {
    const snap = byId('alignment-snap');
    if (snap && !snap.checked) return value;
    const step = alignmentMoveStep(event);
    return Math.round(value / step) * step;
  }

  function onAlignmentPointerMove(event) {
    const drag = alignmentState.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === 'pan') {
      alignmentState.view.panX = drag.panX + event.clientX - drag.startX;
      alignmentState.view.panY = drag.panY + event.clientY - drag.startY;
      updateAlignmentView();
      return;
    }

    const layer = alignmentLayerById(alignmentState.activeLayerId);
    if (!layer) return;
    const dx = (event.clientX - drag.startX) / alignmentState.view.zoom;
    const dy = (event.clientY - drag.startY) / alignmentState.view.zoom;
    layer.centerX = drag.centerX + snapAlignmentDelta(dx, event);
    layer.centerY = drag.centerY + snapAlignmentDelta(dy, event);
    updateAlignmentImages();
  }

  function finishAlignmentDrag(event) {
    const drag = alignmentState.drag;
    if (!drag || (event && drag.pointerId !== event.pointerId)) return;
    alignmentState.drag = null;
    const stage = byId('alignment-stage');
    stage.classList.remove('is-dragging', 'is-panning');
    if (drag.kind === 'layer') {
      renderAlignmentLayerControls();
      updateAlignmentPreviewOutput();
    }
  }

  function onAlignmentKeyDown(event) {
    const stage = byId('alignment-stage');
    if (event.code === 'Space') {
      alignmentState.spacePressed = true;
      stage.classList.add('is-pan-ready');
      event.preventDefault();
      return;
    }
    if (event.key === '+' || event.key === '=') {
      zoomAlignmentBy(1.25);
      event.preventDefault();
      return;
    }
    if (event.key === '-' || event.key === '_') {
      zoomAlignmentBy(1 / 1.25);
      event.preventDefault();
      return;
    }
    if (event.key === '0') {
      resetAlignmentView();
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === 'f') {
      fitAlignmentView();
      event.preventDefault();
      return;
    }

    const layer = alignmentLayerById(alignmentState.activeLayerId);
    if (!layer || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const amount = alignmentMoveStep(event);
    if (event.key === 'ArrowLeft') layer.centerX -= amount;
    if (event.key === 'ArrowRight') layer.centerX += amount;
    if (event.key === 'ArrowUp') layer.centerY -= amount;
    if (event.key === 'ArrowDown') layer.centerY += amount;
    event.preventDefault();
    renderAlignmentLayerControls();
    updateAlignmentImages();
    updateAlignmentPreviewOutput();
  }

  function onAlignmentKeyUp(event) {
    if (event.code !== 'Space') return;
    alignmentState.spacePressed = false;
    byId('alignment-stage').classList.remove('is-pan-ready');
  }

  function clearAlignmentPanModifier() {
    alignmentState.spacePressed = false;
    byId('alignment-stage')?.classList.remove('is-pan-ready');
  }

  function transformedLayerPoint(layer, point) {
    const matrix = alignmentLayerMatrix(layer);
    const x = point.x - layer.width / 2;
    const y = point.y - layer.height / 2;
    return {
      x: layer.centerX + layer.scale * (matrix.a * x + matrix.c * y),
      y: layer.centerY + layer.scale * (matrix.b * x + matrix.d * y)
    };
  }

  function layerScreenPolygon(layer) {
    return [
      { x: 0, y: 0 },
      { x: layer.width, y: 0 },
      { x: layer.width, y: layer.height },
      { x: 0, y: layer.height }
    ].map((point) => transformedLayerPoint(layer, point));
  }

  function inverseLayerPoint(layer, screenPoint) {
    const matrix = alignmentLayerMatrix(layer);
    const dx = (screenPoint.x - layer.centerX) / layer.scale;
    const dy = (screenPoint.y - layer.centerY) / layer.scale;
    return {
      x: layer.width / 2 + matrix.a * dx + matrix.b * dy,
      y: layer.height / 2 + matrix.c * dx + matrix.d * dy
    };
  }

  function roundedAnchorPoint(point) {
    return {
      x: roundNumber(point.x, 4),
      y: roundNumber(point.y, 4)
    };
  }

  function sharedAlignmentReferencePoints() {
    const reference = alignmentState.layers[0];
    if (!reference || !(reference.width > 0) || !(reference.height > 0) || !(reference.scale > 0)) return null;

    // The anchors describe a shared coordinate frame, not necessarily two
    // pixels that remain visible in every crop. Use the reference layer's
    // vertical centre line as a stable pair in alignment-world coordinates.
    // Mapping these world points back through every other layer can naturally
    // produce negative/out-of-bounds source coordinates when crops do not
    // overlap, which is valid and preserves their relative placement.
    return [
      transformedLayerPoint(reference, { x: reference.width / 2, y: 0 }),
      transformedLayerPoint(reference, { x: reference.width / 2, y: reference.height })
    ];
  }

  function generateAlignmentAnchors() {
    if (alignmentState.layers.length < 2) throw new Error('Choose an artwork with at least two usable image layers.');
    const sharedPoints = sharedAlignmentReferencePoints();
    if (!sharedPoints) throw new Error('Could not establish an alignment coordinate frame for this artwork.');

    const mediaAnchors = {};
    for (const layer of alignmentState.layers) {
      const points = sharedPoints.map((point) => roundedAnchorPoint(inverseLayerPoint(layer, point)));
      const span = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      if (!(span > 1e-6)) throw new Error(`Generated anchor points collapse for ${layer.versionId}. Check the layer scale.`);
      const rotation = normalizedRotation(layer.rotation);
      mediaAnchors[layer.mediaId] = {
        points,
        ...(layer.flipX ? { flipX: true } : {}),
        ...(rotation !== 0 ? { rotation } : {})
      };
    }
    return mediaAnchors;
  }

  function alignmentOutputValue(mediaAnchors) {
    return {
      artworkId: alignmentState.artwork?.id,
      sourceFile: alignmentSourceFile(alignmentState.artwork?.id),
      media: Object.fromEntries(Object.entries(mediaAnchors).map(([mediaId, viewerAnchor]) => [mediaId, { viewerAnchor }]))
    };
  }

  function updateAlignmentPreviewOutput() {
    if (alignmentState.layers.length < 2) return;
    try {
      const anchors = generateAlignmentAnchors();
      byId('alignment-output').textContent = JSON.stringify(alignmentOutputValue(anchors), null, 2);
      setAlignmentStatus('');
    } catch (error) {
      byId('alignment-output').textContent = '';
      setAlignmentStatus(error.message, 'error');
    }
  }

  function stripJsonCommentsForAdmin(input) {
    let output = '';
    let inString = false;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      const next = input[index + 1];
      if (lineComment) {
        if (char === '\n') {
          lineComment = false;
          output += char;
        } else output += ' ';
        continue;
      }
      if (blockComment) {
        if (char === '*' && next === '/') {
          blockComment = false;
          output += '  ';
          index += 1;
        } else output += char === '\n' ? '\n' : ' ';
        continue;
      }
      if (inString) {
        output += char;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        output += char;
      } else if (char === '/' && next === '/') {
        lineComment = true;
        output += '  ';
        index += 1;
      } else if (char === '/' && next === '*') {
        blockComment = true;
        output += '  ';
        index += 1;
      } else output += char;
    }
    return output;
  }

  function removeTrailingCommasForAdmin(input) {
    let output = '';
    let inString = false;
    let escaped = false;
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      if (inString) {
        output += char;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        output += char;
        continue;
      }
      if (char === ',') {
        let lookahead = index + 1;
        while (lookahead < input.length && /\s/.test(input[lookahead])) lookahead += 1;
        if (input[lookahead] === '}' || input[lookahead] === ']') continue;
      }
      output += char;
    }
    return output;
  }

  function parseJsoncForAdmin(input) {
    return JSON.parse(removeTrailingCommasForAdmin(stripJsonCommentsForAdmin(input)));
  }

  function leadingJsoncComments(input) {
    const lines = input.split(/(?<=\n)/);
    let result = '';
    for (const line of lines) {
      if (/^\s*\/\//.test(line) || (/^\s*$/.test(line) && result)) result += line;
      else break;
    }
    return result.trimEnd();
  }

  function patchArtworkDocument(text, artworkId, mediaAnchors) {
    const documentValue = parseJsoncForAdmin(text);
    const artworks = Array.isArray(documentValue) ? documentValue : documentValue.artworks;
    if (!Array.isArray(artworks)) throw new Error('Selected source file does not contain an artworks array.');
    const artwork = artworks.find((item) => item.id === artworkId);
    if (!artwork) throw new Error(`Artwork ${artworkId} was not found in the selected source file.`);

    const remaining = new Set(Object.keys(mediaAnchors));
    for (const version of artwork.versions ?? []) {
      for (const media of version.media ?? []) {
        if (!remaining.has(media.id)) continue;
        media.viewerAnchor = mediaAnchors[media.id];
        remaining.delete(media.id);
      }
    }
    if (remaining.size > 0) throw new Error(`Could not find media in source file: ${[...remaining].join(', ')}`);

    const header = leadingJsoncComments(text);
    return `${header ? `${header}\n` : ''}${JSON.stringify(documentValue, null, 2)}\n`;
  }

  async function tryFileHandle(rootHandle, parts) {
    try {
      let directory = rootHandle;
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      return await directory.getFileHandle(parts.at(-1));
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async function resolveArtworkSourceHandle(rootHandle, relativeSourceFile) {
    const clean = String(relativeSourceFile).replace(/^\/+/, '');
    const parts = clean.split('/').filter(Boolean);
    const withoutArtworks = parts[0] === 'artworks' ? parts.slice(1) : parts;
    const candidates = [
      parts,
      withoutArtworks,
      ['data', 'source', ...parts]
    ];
    for (const candidate of candidates) {
      const handle = await tryFileHandle(rootHandle, candidate);
      if (handle) return handle;
    }
    throw new Error(`Could not find ${relativeSourceFile}. Select data/source, data/source/artworks, or the repository root.`);
  }

  async function writeAlignmentAnchors() {
    let anchors;
    try {
      anchors = generateAlignmentAnchors();
      byId('alignment-output').textContent = JSON.stringify(alignmentOutputValue(anchors), null, 2);
    } catch (error) {
      setAlignmentStatus(error.message, 'error');
      return;
    }

    const artworkId = alignmentState.artwork?.id;
    const sourceFile = alignmentSourceFile(artworkId);
    if (!sourceFile) {
      setAlignmentStatus('The build did not expose the source file for this artwork.', 'error');
      return;
    }

    if (typeof window.showDirectoryPicker !== 'function') {
      try {
        await navigator.clipboard?.writeText(byId('alignment-output').textContent);
        setAlignmentStatus('This browser cannot write local files directly. Generated anchors were copied to the clipboard.', 'error');
      } catch {
        setAlignmentStatus('This browser cannot write local files directly. Use the generated anchors shown below.', 'error');
      }
      return;
    }

    try {
      alignmentState.sourceDirectoryHandle ??= await window.showDirectoryPicker({
        id: 'stairs2line-source',
        mode: 'readwrite'
      });
      const fileHandle = await resolveArtworkSourceHandle(alignmentState.sourceDirectoryHandle, sourceFile);
      const file = await fileHandle.getFile();
      const currentText = await file.text();
      const updatedText = patchArtworkDocument(currentText, artworkId, anchors);
      const writable = await fileHandle.createWritable();
      await writable.write(updatedText);
      await writable.close();

      for (const [mediaId, viewerAnchor] of Object.entries(anchors)) {
        if (data.media[mediaId]) data.media[mediaId].viewerAnchor = viewerAnchor;
      }
      if (byId('artwork-existing').value === artworkId) loadArtwork(artworkId);
      setAlignmentStatus(`Wrote ${Object.keys(anchors).length} viewerAnchor value(s) to data/source/${sourceFile}. Rebuild the site to validate them.`, 'success');
    } catch (error) {
      if (error?.name === 'AbortError') {
        setAlignmentStatus('Source-file write cancelled.');
        return;
      }
      setAlignmentStatus(error.message, 'error');
    }
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
    byId('platform-existing').addEventListener('change', (event) => loadPlatform(event.target.value));
    byId('artwork-existing').addEventListener('change', (event) => loadArtwork(event.target.value));
    byId('alignment-artwork').addEventListener('change', (event) => renderAlignmentEditor(event.target.value));
    byId('post-form').addEventListener('submit', generatePost);
    byId('platform-form').addEventListener('submit', generatePlatform);
    byId('artwork-form').addEventListener('submit', generateArtwork);
    byId('date-form').addEventListener('submit', extractDates);
    byId('media-filter').addEventListener('input', (event) => renderMedia(event.target.value));
    byId('alignment-reset').addEventListener('click', () => renderAlignmentEditor(alignmentState.artwork?.id ?? ''));
    byId('alignment-zoom-out').addEventListener('click', () => zoomAlignmentBy(1 / 1.25));
    byId('alignment-zoom-in').addEventListener('click', () => zoomAlignmentBy(1.25));
    byId('alignment-zoom-reset').addEventListener('click', resetAlignmentView);
    byId('alignment-fit').addEventListener('click', fitAlignmentView);
    byId('alignment-write').addEventListener('click', writeAlignmentAnchors);
    byId('alignment-layers').addEventListener('input', onAlignmentLayerInput);
    byId('alignment-layers').addEventListener('change', onAlignmentLayerInput);
    byId('alignment-layers').addEventListener('click', onAlignmentLayerClick);
    byId('alignment-stage').addEventListener('pointerdown', onAlignmentPointerDown);
    byId('alignment-stage').addEventListener('pointermove', onAlignmentPointerMove);
    byId('alignment-stage').addEventListener('pointerup', finishAlignmentDrag);
    byId('alignment-stage').addEventListener('pointercancel', finishAlignmentDrag);
    byId('alignment-stage').addEventListener('wheel', onAlignmentWheel, { passive: false });
    byId('alignment-stage').addEventListener('keydown', onAlignmentKeyDown);
    byId('alignment-stage').addEventListener('keyup', onAlignmentKeyUp);
    window.addEventListener('blur', clearAlignmentPanModifier);
    document.querySelectorAll('[data-download]').forEach((button) => button.addEventListener('click', () => downloadOutput(button.dataset.download)));
  }

  initialize().catch((error) => {
    document.body.insertAdjacentHTML('afterbegin', `<pre>${error.stack}</pre>`);
  });
})();
