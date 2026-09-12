(() => {
  class PageMediaProvider {
    constructor(rootSelector, mediaSelector = '[data-viewer-media]') {
      this.rootSelector = rootSelector;
      this.mediaSelector = mediaSelector;
    }

    getItems() {
      const items = [];
      const seen = new Set();
      for (const root of document.querySelectorAll(this.rootSelector)) {
        for (const item of root.querySelectorAll(this.mediaSelector)) {
          if (seen.has(item)) continue;
          seen.add(item);
          items.push(item);
        }
      }
      return items;
    }

    getNext(element, callback) {
      const items = this.getItems();
      const index = items.indexOf(element);

      if (index >= 0 && index + 1 < items.length) {
        callback(items[index + 1]);
        return;
      }

      const feed = window.Stairs2lineArchiveFeed;
      if (index >= 0 && feed?.mode === 'feed' && feed.hasNext()) {
        feed.loadNextPage().then(() => {
          const updatedItems = this.getItems();
          callback(updatedItems[index + 1] ?? null);
        });
        return;
      }

      callback(null);
    }

    getPrev(element, callback) {
      const items = this.getItems();
      const index = items.indexOf(element);
      callback(index > 0 ? items[index - 1] : null);
    }
  }

  function mediaSource(element) {
    if (!element) return null;
    if (element.matches('img')) return element.currentSrc || element.src || null;
    if (element.matches('video')) {
      return element.currentSrc || element.src || element.querySelector('source')?.src || null;
    }
    return null;
  }

  function makeSwitcherPreview(element) {
    const src = mediaSource(element);
    if (!src) return null;

    if (element.matches('video')) {
      const video = document.createElement('video');
      video.src = src;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      return video;
    }

    const image = document.createElement('img');
    image.src = src;
    image.alt = '';
    image.decoding = 'async';
    return image;
  }

  function finiteNumber(value) {
    const number = Number.parseFloat(value ?? '');
    return Number.isFinite(number) ? number : null;
  }

  function orientationMatrix(flipX = false, rotation = 0) {
    const radians = rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const mirror = flipX ? -1 : 1;

    // Orientation is defined as a horizontal mirror first, then a clockwise
    // rotation in screen coordinates. CSS matrix(a,b,c,d) uses the same
    // coordinate convention. In particular flipX + 180deg equals flipY.
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

  function sourceAlignmentGeometry(element) {
    if (!element) return null;
    const width = finiteNumber(element.getAttribute('width'));
    const height = finiteNumber(element.getAttribute('height'));
    if (!(width > 0) || !(height > 0)) return null;

    const explicit = [
      finiteNumber(element.dataset.viewerAnchorX1),
      finiteNumber(element.dataset.viewerAnchorY1),
      finiteNumber(element.dataset.viewerAnchorX2),
      finiteNumber(element.dataset.viewerAnchorY2)
    ];
    const rawPoints = explicit.every((value) => value !== null)
      ? [
        { x: explicit[0], y: explicit[1] },
        { x: explicit[2], y: explicit[3] }
      ]
      : [
        { x: width / 2, y: 0 },
        { x: width / 2, y: height }
      ];
    const flipX = element.dataset.viewerFlipX === 'true';
    const rotation = finiteNumber(element.dataset.viewerRotation) ?? 0;
    const matrix = orientationMatrix(flipX, rotation);
    const points = rawPoints.map((point) => orientPoint(point, width, height, matrix));
    const corners = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height }
    ].map((point) => orientPoint(point, width, height, matrix));
    const center = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    };
    const span = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    if (!(span > 0)) return null;

    return { width, height, points, center, span, corners, matrix };
  }

  class MediaViewer {
    constructor(modalSelector, renderMedia) {
      this.modal = document.querySelector(modalSelector);
      if (!this.modal) {
        console.error(`Could not find "${modalSelector}"`);
        return;
      }

      this.renderMedia = renderMedia;
      this.mediaProvider = null;
      this.prev = null;
      this.next = null;
      this.currentElement = null;
      this.renderedMedia = null;
      this.isSubscribed = false;
      this.navigationToken = 0;
      this.alignmentReference = null;
      this.swipe = null;
      this.ignoreClickUntil = 0;
      this.wheelDelta = 0;
      this.lastWheelSwitch = 0;
      this.mediaResizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => requestAnimationFrame(() => this.updateSwitcherPlacement()))
        : null;

      this.leftSwitcher = this.modal.querySelector('.media-viewer-switcher-left');
      this.rightSwitcher = this.modal.querySelector('.media-viewer-switcher-right');
      this.closeButton = this.modal.querySelector('.media-viewer-close');

      this.onKeyDown = this.onKeyDown.bind(this);
      this.onWheel = this.onWheel.bind(this);
      this.onBackdropClick = this.onBackdropClick.bind(this);
      this.onLeftClick = this.onClick.bind(this, 'prev');
      this.onRightClick = this.onClick.bind(this, 'next');
      this.onCloseClick = this.onCloseClick.bind(this);
      this.onPointerDown = this.onPointerDown.bind(this);
      this.onPointerUp = this.onPointerUp.bind(this);
      this.onPointerCancel = this.onPointerCancel.bind(this);
      this.onResize = this.onResize.bind(this);
    }

    show(element, mediaProvider) {
      if (!this.modal || !element || !mediaProvider) return;

      if (!this.isSubscribed) {
        this.subscribe();
        this.isSubscribed = true;
      }

      const nextGroup = element.dataset.viewerAlignGroup || null;
      const currentGroup = this.currentElement?.dataset.viewerAlignGroup || null;
      if (nextGroup !== currentGroup) this.alignmentReference = nextGroup ? element : null;

      this.mediaProvider = mediaProvider;
      this.currentElement = element;
      this.open();
      this.renderMedia(element);
      this.updateNavigation(element, mediaProvider);
    }

    updateNavigation(element, mediaProvider) {
      const token = ++this.navigationToken;
      this.prev = null;
      this.next = null;
      this.updateSwitcher(this.leftSwitcher, null, 'prev');
      this.updateSwitcher(this.rightSwitcher, null, 'next');

      mediaProvider.getPrev(element, (prev) => {
        if (token !== this.navigationToken) return;
        this.prev = prev;
        this.updateSwitcher(this.leftSwitcher, prev, 'prev');
      });

      mediaProvider.getNext(element, (next) => {
        if (token !== this.navigationToken) return;
        this.next = next;
        this.updateSwitcher(this.rightSwitcher, next, 'next');
      });
    }

    updateSwitcher(switcher, target, direction) {
      if (!switcher) return;
      switcher.classList.toggle('hidden', !target);
      switcher.disabled = !target;
      const preview = switcher.querySelector('.media-viewer-switcher-preview');
      if (preview) {
        preview.replaceChildren();
        const media = makeSwitcherPreview(target);
        if (media) preview.append(media);
      }
      switcher.dataset.direction = direction;
    }

    open() {
      this.modal.hidden = false;
      this.modal.setAttribute('aria-hidden', 'false');
      this.modal.classList.add('show');
      this.modal.focus({ preventScroll: true });
    }

    close() {
      if (!this.modal || this.modal.getAttribute('aria-hidden') === 'true') return;

      for (const video of this.modal.querySelectorAll('video')) video.pause?.();

      this.modal.classList.remove('show');
      this.modal.classList.remove('is-video');
      this.modal.hidden = true;
      this.modal.setAttribute('aria-hidden', 'true');

      this.unsubscribe();
      this.isSubscribed = false;
      this.mediaProvider = null;
      this.prev = null;
      this.next = null;
      this.currentElement = null;
      this.renderedMedia = null;
      this.alignmentReference = null;
      this.swipe = null;
      this.wheelDelta = 0;
      this.navigationToken += 1;
      this.mediaResizeObserver?.disconnect();

      this.updateSwitcher(this.leftSwitcher, null, 'prev');
      this.updateSwitcher(this.rightSwitcher, null, 'next');
      for (const switcher of [this.leftSwitcher, this.rightSwitcher]) {
        switcher?.style.removeProperty('width');
        switcher?.style.removeProperty('height');
        switcher?.style.removeProperty('top');
      }
    }

    canSwitch() {
      return typeof window.hasModalUnsaved !== 'function' || !window.hasModalUnsaved(this.modal);
    }

    subscribe() {
      document.addEventListener('keydown', this.onKeyDown);
      this.modal.addEventListener('wheel', this.onWheel, { passive: false });
      this.modal.addEventListener('click', this.onBackdropClick);
      this.modal.addEventListener('pointerdown', this.onPointerDown, { passive: true });
      this.modal.addEventListener('pointerup', this.onPointerUp, { passive: true });
      this.modal.addEventListener('pointercancel', this.onPointerCancel, { passive: true });
      window.addEventListener('resize', this.onResize);
      this.leftSwitcher?.addEventListener('click', this.onLeftClick);
      this.rightSwitcher?.addEventListener('click', this.onRightClick);
      this.closeButton?.addEventListener('click', this.onCloseClick);
    }

    unsubscribe() {
      document.removeEventListener('keydown', this.onKeyDown);
      this.modal.removeEventListener('wheel', this.onWheel);
      this.modal.removeEventListener('click', this.onBackdropClick);
      this.modal.removeEventListener('pointerdown', this.onPointerDown);
      this.modal.removeEventListener('pointerup', this.onPointerUp);
      this.modal.removeEventListener('pointercancel', this.onPointerCancel);
      window.removeEventListener('resize', this.onResize);
      this.leftSwitcher?.removeEventListener('click', this.onLeftClick);
      this.rightSwitcher?.removeEventListener('click', this.onRightClick);
      this.closeButton?.removeEventListener('click', this.onCloseClick);
    }

    onBackdropClick(event) {
      if (Date.now() < this.ignoreClickUntil || !this.canSwitch()) return;
      if (event.target.closest('.media-viewer-current, .modal-subtext, .media-viewer-switcher, .media-viewer-close, .media-viewer-play-button')) return;

      this.close();
    }

    onCloseClick(event) {
      event.stopPropagation();
      if (this.canSwitch()) this.close();
    }

    onKeyDown(event) {
      if (event.key === 'Escape') {
        if (this.canSwitch()) this.close();
        return;
      }

      if (!this.canSwitch()) return;

      switch (event.key) {
        case 'ArrowLeft':
          if (this.prev) this.show(this.prev, this.mediaProvider);
          event.preventDefault();
          break;
        case 'ArrowRight':
          if (this.next) this.show(this.next, this.mediaProvider);
          event.preventDefault();
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          event.preventDefault();
          break;
      }
    }

    onWheel(event) {
      if (event.target.closest('.modal-subtext')) return;
      event.preventDefault();
      if (!this.canSwitch()) return;

      const dominant = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      this.wheelDelta += dominant;
      const now = performance.now();
      if (Math.abs(this.wheelDelta) < 52 || now - this.lastWheelSwitch < 300) return;

      const direction = this.wheelDelta > 0 ? 'next' : 'prev';
      this.wheelDelta = 0;
      this.lastWheelSwitch = now;
      this.switchDirection(direction);
    }

    onPointerDown(event) {
      if (event.pointerType !== 'touch' || !this.canSwitch()) return;
      if (event.target.closest('.modal-subtext, .media-viewer-switcher')) return;

      const edgeGuard = 28;
      if (event.clientX <= edgeGuard || event.clientX >= window.innerWidth - edgeGuard) return;

      this.swipe = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startedAt: performance.now()
      };
    }

    onPointerUp(event) {
      if (!this.swipe || event.pointerId !== this.swipe.pointerId) return;
      const swipe = this.swipe;
      this.swipe = null;

      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      const elapsed = performance.now() - swipe.startedAt;
      const threshold = Math.min(110, Math.max(52, window.innerWidth * 0.11));
      if (elapsed > 1200 || Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy) * 1.2) return;

      this.ignoreClickUntil = Date.now() + 350;
      this.switchDirection(dx < 0 ? 'next' : 'prev');
    }

    onPointerCancel() {
      this.swipe = null;
    }

    onResize() {
      requestAnimationFrame(() => {
        this.reflowAlignment();
        this.updateSwitcherPlacement();
      });
    }

    onClick(direction, event) {
      event.stopPropagation();
      if (!this.canSwitch()) return;
      this.switchDirection(direction);
    }

    switchDirection(direction) {
      if (direction === 'next' && this.next) {
        this.show(this.next, this.mediaProvider);
      } else if (direction === 'prev' && this.prev) {
        this.show(this.prev, this.mediaProvider);
      }
    }

    setRenderedMedia(media, sourceElement) {
      this.renderedMedia = media;
      this.currentElement = sourceElement;
      this.modal.classList.toggle('is-video', media?.matches?.('video') ?? false);
      this.mediaResizeObserver?.disconnect();
      if (media) this.mediaResizeObserver?.observe(media);

      // Images and especially videos can change their rendered box after the
      // viewer opens (video metadata/aspect ratio may arrive a little later).
      // Recompute the navigation gutters when that happens so the hit areas
      // still end exactly at the visible media instead of covering it.
      const refreshPlacement = () => requestAnimationFrame(() => this.updateSwitcherPlacement());
      media?.addEventListener?.('load', refreshPlacement, { once: true });
      media?.addEventListener?.('loadedmetadata', refreshPlacement, { once: true });
      this.reflowAlignment();
      requestAnimationFrame(() => this.updateSwitcherPlacement());
    }

    updateSwitcherPlacement() {
      for (const switcher of [this.leftSwitcher, this.rightSwitcher]) {
        switcher?.style.removeProperty('width');
        switcher?.style.removeProperty('height');
        switcher?.style.removeProperty('top');
      }
      if (!this.renderedMedia || window.innerWidth <= 768) return;

      // Horizontally the navigation again fills all free space from the edge
      // of the viewport up to the actual rendered media. Vertically it keeps
      // the CSS-defined fixed band, independent of image/video height.
      const rect = this.renderedMedia.getBoundingClientRect?.();
      const viewportRect = this.modal.getBoundingClientRect?.();
      if (!rect || !viewportRect) return;
      const leftSpace = Math.max(0, rect.left - viewportRect.left);
      const rightSpace = Math.max(0, viewportRect.right - rect.right);
      if (this.leftSwitcher) this.leftSwitcher.style.width = `${leftSpace}px`;
      if (this.rightSwitcher) this.rightSwitcher.style.width = `${rightSpace}px`;
    }

    reflowAlignment() {
      const media = this.renderedMedia;
      const source = this.currentElement;
      if (!media || !source) return;

      const clearAlignment = () => {
        media.classList.remove('is-artwork-aligned');
        media.style.removeProperty('left');
        media.style.removeProperty('top');
        media.style.removeProperty('width');
        media.style.removeProperty('height');
        media.style.removeProperty('transform');
        media.style.removeProperty('transform-origin');
      };

      const group = source.dataset.viewerAlignGroup || null;
      if (!group) {
        clearAlignment();
        return;
      }

      if (!this.alignmentReference || this.alignmentReference.dataset.viewerAlignGroup !== group) {
        this.alignmentReference = source;
      }

      const stage = this.modal.querySelector('#mediaModalContent');
      const rect = stage?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;

      const reference = sourceAlignmentGeometry(this.alignmentReference);
      if (!reference) {
        clearAlignment();
        return;
      }

      const groupItems = (this.mediaProvider?.getItems?.() ?? [])
        .filter((item) => item.dataset.viewerAlignGroup === group)
        .map((item) => ({ element: item, geometry: sourceAlignmentGeometry(item) }))
        .filter((item) => item.geometry);
      if (!groupItems.some((item) => item.element === source)) {
        clearAlignment();
        return;
      }

      const positions = new Map();
      let unionLeft = Infinity;
      let unionTop = Infinity;
      let unionRight = -Infinity;
      let unionBottom = -Infinity;

      for (const item of groupItems) {
        const scaleToReference = reference.span / item.geometry.span;
        if (!(scaleToReference > 0) || !Number.isFinite(scaleToReference)) continue;

        const left = reference.center.x - item.geometry.center.x * scaleToReference;
        const top = reference.center.y - item.geometry.center.y * scaleToReference;
        for (const corner of item.geometry.corners) {
          const x = left + corner.x * scaleToReference;
          const y = top + corner.y * scaleToReference;
          unionLeft = Math.min(unionLeft, x);
          unionTop = Math.min(unionTop, y);
          unionRight = Math.max(unionRight, x);
          unionBottom = Math.max(unionBottom, y);
        }
        positions.set(item.element, { left, top, scaleToReference, geometry: item.geometry });
      }

      const currentPosition = positions.get(source);
      const unionWidth = unionRight - unionLeft;
      const unionHeight = unionBottom - unionTop;
      if (!currentPosition || !(unionWidth > 0) || !(unionHeight > 0)) {
        clearAlignment();
        return;
      }

      // Fit the union of every registered version, not merely the currently
      // visible image. This keeps the same source pixels at the same screen
      // coordinates even when another version is a wider/taller uncropped
      // image, while guaranteeing that every version still fits on screen.
      const viewportScale = Math.min(rect.width / unionWidth, rect.height / unionHeight);
      if (!(viewportScale > 0) || !Number.isFinite(viewportScale)) {
        clearAlignment();
        return;
      }

      const originX = (rect.width - unionWidth * viewportScale) / 2 - unionLeft * viewportScale;
      const originY = (rect.height - unionHeight * viewportScale) / 2 - unionTop * viewportScale;
      const scale = currentPosition.scaleToReference * viewportScale;
      const width = currentPosition.geometry.width * scale;
      const height = currentPosition.geometry.height * scale;
      const left = originX + currentPosition.left * viewportScale;
      const top = originY + currentPosition.top * viewportScale;

      media.classList.add('is-artwork-aligned');
      media.style.width = `${width}px`;
      media.style.height = `${height}px`;
      media.style.left = `${left}px`;
      media.style.top = `${top}px`;
      const matrix = currentPosition.geometry.matrix;
      media.style.transformOrigin = 'center center';
      media.style.transform = `matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, 0, 0)`;
      tryPixelateImage(media);
    }
  }

  const scriptUrl = document.currentScript?.src ?? document.baseURI;
  const archiveRootUrl = new URL('../', scriptUrl);
  const viewerIndexUrl = new URL('../data/viewer-index.json', scriptUrl);
  let viewerIndexPromise = null;

  function getViewerIndex() {
    viewerIndexPromise ??= fetch(viewerIndexUrl).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    return viewerIndexPromise;
  }

  function localized(value, language) {
    if (!value || typeof value !== 'object') return value ?? '';
    return value[language] ?? value.default ?? Object.values(value).find(Boolean) ?? '';
  }

  function formatViewerDate(value, language, approximate = false) {
    if (!value) return 'Unknown date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    let formatted;
    try {
      formatted = new Intl.DateTimeFormat(language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC'
      }).format(date);
    } catch {
      formatted = date.toLocaleString();
    }
    return approximate ? `≈ ${formatted}` : formatted;
  }

  function viewerPlatformLabel(index, platformId, language) {
    return localized(index.platforms?.[platformId]?.label, language) || platformId;
  }

  function viewerString(index, language, key, fallback = '') {
    return index.viewerStrings?.[language]?.[key]
      ?? index.viewerStrings?.en?.[key]
      ?? fallback;
  }

  function postReferenceText(index, post, language, statusOverride = null) {
    const date = formatViewerDate(post.publishedAt, language, post.dateApproximate);
    const platform = viewerPlatformLabel(index, post.platform, language);
    const status = statusOverride ?? post.status;
    const suffix = status === 'deleted' || status === 'lost' ? ` · ${status}` : '';
    return `${date} · ${platform}${suffix}`;
  }

  function internalPostUrl(post, language) {
    return new URL(
      `${encodeURIComponent(language)}/posts/${encodeURIComponent(post.platform)}/${encodeURIComponent(post.id)}/`,
      archiveRootUrl
    ).href;
  }

  async function updateFooter(element) {
    const footer = document.querySelector('.modal-subtext');
    if (!footer) return;
    footer.textContent = '';

    try {
      const index = await getViewerIndex();
      const media = index.media[element.dataset.mediaId];
      if (!media) return;

      const language = document.documentElement.lang || 'en';
      const contextType = element.dataset.contextType;
      const contextId = element.dataset.contextId;
      let currentPost = null;
      let currentVersion = null;

      if (contextType === 'post' && index.posts[contextId]) {
        currentPost = index.posts[contextId];
        const versionIndex = Number.parseInt(element.dataset.contextVersion ?? '', 10);
        currentVersion = Number.isInteger(versionIndex) && currentPost.versions?.[versionIndex]
          ? currentPost.versions[versionIndex]
          : currentPost;
        const title = localized(currentVersion.title, language);
        if (title) {
          const line = document.createElement('div');
          line.className = 'media-viewer-context';
          line.textContent = title;
          footer.append(line);
        }
      }

      if (contextType === 'artworkVersion') {
        const artwork = index.artworks[media.artworkId];
        if (artwork) {
          const line = document.createElement('div');
          line.className = 'media-viewer-context';
          line.textContent = `${localized(artwork.title, language) || artwork.id} · ${media.versionId}`;
          footer.append(line);
        }
      }

      const postIds = [...new Set(media.postIds ?? [])];
      if (currentPost && !postIds.includes(contextId)) postIds.unshift(contextId);
      const list = document.createElement('div');
      list.className = 'media-viewer-post-list';

      for (const postId of postIds) {
        const post = index.posts[postId];
        if (!post) continue;
        const isCurrent = Boolean(currentPost && postId === contextId);
        const status = isCurrent ? currentVersion?.status ?? post.status : post.status;
        const reference = document.createElement('span');
        reference.className = 'media-viewer-post-reference';
        const item = document.createElement('a');
        item.className = `media-viewer-post-link${isCurrent ? ' is-current' : ''}`;
        item.textContent = postReferenceText(index, post, language, status);
        item.href = internalPostUrl(post, language);

        if (isCurrent) item.setAttribute('aria-current', 'page');
        reference.append(item);

        if (post.href) {
          const original = document.createElement('a');
          original.className = 'media-viewer-post-original';
          original.href = post.href;
          original.target = '_blank';
          original.rel = 'noreferrer';
          original.textContent = '↗';
          original.title = viewerString(index, language, 'originalPost', 'Open original post');
          original.setAttribute('aria-label', original.title);
          reference.append(original);
        }
        list.append(reference);
      }

      if (list.childElementCount === 0) {
        const empty = document.createElement('span');
        empty.className = 'media-viewer-post-link is-empty';
        empty.textContent = viewerString(index, language, 'noKnownPosts', 'No known posts use this image.');
        list.append(empty);
      }

      footer.append(list);
    } catch (error) {
      console.error('Could not render MediaViewer metadata.', error);
    }
  }

  function tryPixelateImage(image) {
    if (!image?.matches?.('img')) return;
    const update = () => {
      const tinySource = image.naturalWidth <= 512 || image.naturalHeight <= 512;
      const stronglyUpscaled =
        image.clientWidth >= image.naturalWidth * 1.75 &&
        image.clientHeight >= image.naturalHeight * 1.75;
      const pixelate = tinySource && stronglyUpscaled;

      image.classList.toggle('pixelated', pixelate);
    };

    if (image.complete && image.naturalWidth > 0) {
      update();
    } else {
      image.addEventListener('load', update, { once: true });
    }
  }

  function constrainViewerImage(image) {
    if (!image?.matches?.('img.media-viewer-current')) return;
    const update = () => {
      if (!(image.naturalWidth > 0) || !(image.naturalHeight > 0)) return;
      const ratio = image.naturalWidth / image.naturalHeight;
      // Very small panoramas looked especially broken when scaled to the full
      // desktop viewer width. Let ordinary images grow enough to be useful,
      // but keep ultra-wide sources closer to their native dimensions.
      const widthScale = ratio > 3 ? 2 : 3;
      const heightScale = ratio > 3 ? 2 : 3;
      const maxWidth = Math.min(960, Math.max(image.naturalWidth, image.naturalWidth * widthScale));
      const maxHeight = Math.min(window.innerHeight, Math.max(image.naturalHeight, image.naturalHeight * heightScale));
      image.style.setProperty('--viewer-image-max-width', `${maxWidth}px`);
      image.style.setProperty('--viewer-image-max-height', `${maxHeight}px`);
    };

    if (image.complete && image.naturalWidth > 0) update();
    else image.addEventListener('load', update, { once: true });
  }

  function freezeGalleryGif(image) {
    if (!image?.matches?.('img[data-gallery-static-gif]') || image.dataset.galleryGifFrozen === 'true') return;
    image.dataset.galleryGifFrozen = 'true';

    const drawPoster = () => {
      if (!(image.naturalWidth > 0) || !(image.naturalHeight > 0)) return;
      const originalSrc = image.currentSrc || image.src;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      try {
        const context = canvas.getContext('2d');
        context?.drawImage(image, 0, 0, canvas.width, canvas.height);
        const posterSrc = canvas.toDataURL('image/png');
        if (!posterSrc) return;
        image.dataset.galleryAnimatedSrc = originalSrc;
        image.removeAttribute('srcset');
        image.src = posterSrc;
        image.classList.add('is-gallery-gif-frozen');
      } catch (error) {
        console.warn('Could not freeze GIF gallery preview.', error);
      }
    };

    if (image.complete && image.naturalWidth > 0) drawPoster();
    else image.addEventListener('load', drawPoster, { once: true });
  }

  function freezeGalleryGifs(root = document) {
    for (const image of root.querySelectorAll?.('img[data-gallery-static-gif]') ?? []) freezeGalleryGif(image);
  }

  function showFullSizeCopy(sourceElement, viewer) {
    const media = sourceElement.cloneNode(true);
    media.removeAttribute('onclick');
    media.removeAttribute('style');
    media.classList.remove('clickable');
    media.classList.add('media-viewer-current');

    if (media.matches('img[data-gallery-static-gif]') && sourceElement.dataset.galleryAnimatedSrc) {
      media.removeAttribute('srcset');
      media.src = sourceElement.dataset.galleryAnimatedSrc;
      media.classList.remove('is-gallery-gif-frozen');
    }

    const videos = media.matches('video')
      ? [media]
      : [...media.querySelectorAll('video')];

    const container = document.querySelector('#mediaModalContent');
    if (!container) return;

    for (const oldVideo of container.querySelectorAll('video')) oldVideo.pause?.();
    container.replaceChildren(media);

    for (const video of videos) {
      video.autoplay = true;
      video.setAttribute('autoplay', '');
      video.controls = true;

      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.className = 'media-viewer-play-button';
      playButton.setAttribute('aria-label', 'Play video');
      playButton.textContent = '▶';
      const syncPlayButton = () => {
        playButton.hidden = !video.paused && !video.ended;
      };
      playButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (video.paused || video.ended) video.play?.().catch(() => {});
        else video.pause?.();
      });
      video.addEventListener('play', syncPlayButton);
      video.addEventListener('pause', syncPlayButton);
      video.addEventListener('ended', syncPlayButton);
      container.append(playButton);
      syncPlayButton();

      // The viewer is opened directly by a user click, so request playback
      // immediately while that activation is still available. If a browser
      // rejects it, the explicit play button remains visible as the fallback.
      video.play?.().catch(() => syncPlayButton());
    }

    const image = media.matches('img') ? media : media.querySelector('img');
    if (image) {
      constrainViewerImage(image);
      tryPixelateImage(image);
    }
    viewer.setRenderedMedia(media, sourceElement);
  }

  function createModal() {
    let modal = document.querySelector('#mediaModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal" id="mediaModal" tabindex="-1" aria-hidden="true" hidden>
        <div class="modal-dialog">
          <div id="mediaModalContent" class="fullsize-media fit-media fit-media-copyable"></div>
        </div>
        <div class="modal-subtext"></div>
        <button type="button" class="media-viewer-close" aria-label="Close media viewer">×</button>
        <button type="button" class="media-viewer-switcher media-viewer-switcher-left hidden" aria-label="Previous media">
          <span class="media-viewer-switcher-chevron" aria-hidden="true">‹</span>
          <span class="media-viewer-switcher-preview" aria-hidden="true"></span>
        </button>
        <button type="button" class="media-viewer-switcher media-viewer-switcher-right hidden" aria-label="Next media">
          <span class="media-viewer-switcher-preview" aria-hidden="true"></span>
          <span class="media-viewer-switcher-chevron" aria-hidden="true">›</span>
        </button>
      </div>
    `);

    return document.querySelector('#mediaModal');
  }

  function install() {
    const modal = createModal();
    if (!modal) return;

    // Feed/listing pages expose their media through data-paged-list. Individual
    // post pages use post-version-list instead; without that fallback a
    // multi-image post (notably the Piapro Blog entries) could open the viewer
    // but had no previous/next items to navigate to.
    const provider = new PageMediaProvider('[data-paged-list], .post-version-list');
    let viewer;

    viewer = new MediaViewer('#mediaModal', (element) => {
      showFullSizeCopy(element, viewer);
      updateFooter(element).finally(() => viewer.reflowAlignment());
    });

    document.addEventListener('click', (event) => {
      const link = event.target.closest('.media-link');
      const media = link?.querySelector('[data-viewer-media]');
      if (!media) return;

      event.preventDefault();
      viewer.show(media, provider);
    });

    const enhanceMediaPreviews = () => {
      for (const image of document.querySelectorAll('img[data-viewer-media]')) tryPixelateImage(image);
      freezeGalleryGifs(document);
    };
    enhanceMediaPreviews();
    document.addEventListener('archive:feed-appended', enhanceMediaPreviews);

    window.MediaViewer = MediaViewer;
    window.showFullSizeCopy = (sourceElement) => showFullSizeCopy(sourceElement, viewer);
    window.tryPixelateImage = tryPixelateImage;
    window.stairs2lineMediaViewer = viewer;
    window.stairs2lineMediaProvider = provider;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
