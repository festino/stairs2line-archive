(() => {
  class PageMediaProvider {
    constructor(rootSelector, mediaSelector = '[data-viewer-media]') {
      this.rootSelector = rootSelector;
      this.mediaSelector = mediaSelector;
    }

    getItems() {
      return [...document.querySelectorAll(`${this.rootSelector} ${this.mediaSelector}`)];
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

  function finiteNormalized(value, fallback) {
    const number = Number.parseFloat(value ?? '');
    return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
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
      this.alignmentTarget = null;
      this.swipe = null;
      this.ignoreClickUntil = 0;
      this.wheelDelta = 0;
      this.lastWheelSwitch = 0;

      this.leftSwitcher = this.modal.querySelector('.media-viewer-switcher-left');
      this.rightSwitcher = this.modal.querySelector('.media-viewer-switcher-right');

      this.onKeyDown = this.onKeyDown.bind(this);
      this.onWheel = this.onWheel.bind(this);
      this.onBackdropClick = this.onBackdropClick.bind(this);
      this.onLeftClick = this.onClick.bind(this, 'prev');
      this.onRightClick = this.onClick.bind(this, 'next');
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
      if (nextGroup !== currentGroup) this.alignmentTarget = null;

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

      this.modal.classList.remove('show');
      this.modal.hidden = true;
      this.modal.setAttribute('aria-hidden', 'true');

      this.unsubscribe();
      this.isSubscribed = false;
      this.mediaProvider = null;
      this.prev = null;
      this.next = null;
      this.currentElement = null;
      this.renderedMedia = null;
      this.alignmentTarget = null;
      this.swipe = null;
      this.wheelDelta = 0;
      this.navigationToken += 1;

      this.updateSwitcher(this.leftSwitcher, null, 'prev');
      this.updateSwitcher(this.rightSwitcher, null, 'next');
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
    }

    onBackdropClick(event) {
      if (Date.now() < this.ignoreClickUntil || !this.canSwitch()) return;
      if (event.target.closest('.media-viewer-current, .modal-subtext, .media-viewer-switcher')) return;
      this.close();
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
      requestAnimationFrame(() => this.reflowAlignment());
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
      this.reflowAlignment();
    }

    reflowAlignment() {
      const media = this.renderedMedia;
      const source = this.currentElement;
      if (!media || !source) return;

      const group = source.dataset.viewerAlignGroup || null;
      if (!group) {
        media.classList.remove('is-artwork-aligned');
        media.style.removeProperty('left');
        media.style.removeProperty('top');
        media.style.removeProperty('width');
        media.style.removeProperty('height');
        return;
      }

      const stage = this.modal.querySelector('#mediaModalContent');
      const rect = stage?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;

      const isImage = media.matches('img');
      const intrinsicWidth = isImage ? media.naturalWidth : media.videoWidth;
      const intrinsicHeight = isImage ? media.naturalHeight : media.videoHeight;
      if (!intrinsicWidth || !intrinsicHeight) {
        const readyEvent = isImage ? 'load' : 'loadedmetadata';
        media.addEventListener(readyEvent, () => this.reflowAlignment(), { once: true });
        return;
      }

      const anchorX = finiteNormalized(source.dataset.viewerAnchorX, 0.5);
      const anchorY = finiteNormalized(source.dataset.viewerAnchorY, 0.5);
      const stageWidth = rect.width;
      const stageHeight = rect.height;

      if (!this.alignmentTarget || this.alignmentTarget.group !== group) {
        const centeredScale = Math.min(stageWidth / intrinsicWidth, stageHeight / intrinsicHeight);
        const centeredWidth = intrinsicWidth * centeredScale;
        const centeredHeight = intrinsicHeight * centeredScale;
        const centeredLeft = (stageWidth - centeredWidth) / 2;
        const centeredTop = (stageHeight - centeredHeight) / 2;
        this.alignmentTarget = {
          group,
          x: (centeredLeft + anchorX * centeredWidth) / stageWidth,
          y: (centeredTop + anchorY * centeredHeight) / stageHeight
        };
      }

      const targetX = this.alignmentTarget.x * stageWidth;
      const targetY = this.alignmentTarget.y * stageHeight;
      const limits = [stageWidth / intrinsicWidth, stageHeight / intrinsicHeight];
      if (anchorX > 0) limits.push(targetX / (anchorX * intrinsicWidth));
      if (anchorX < 1) limits.push((stageWidth - targetX) / ((1 - anchorX) * intrinsicWidth));
      if (anchorY > 0) limits.push(targetY / (anchorY * intrinsicHeight));
      if (anchorY < 1) limits.push((stageHeight - targetY) / ((1 - anchorY) * intrinsicHeight));
      const scale = Math.max(0, Math.min(...limits.filter((value) => Number.isFinite(value) && value >= 0)));
      if (!scale) return;

      const width = intrinsicWidth * scale;
      const height = intrinsicHeight * scale;
      const left = targetX - anchorX * width;
      const top = targetY - anchorY * height;

      media.classList.add('is-artwork-aligned');
      media.style.width = `${width}px`;
      media.style.height = `${height}px`;
      media.style.left = `${left}px`;
      media.style.top = `${top}px`;
      tryPixelateImage(media);
    }
  }

  const scriptUrl = document.currentScript?.src ?? document.baseURI;
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

      if (contextType === 'post' && index.posts[contextId]) {
        const post = index.posts[contextId];
        const versionIndex = Number.parseInt(element.dataset.contextVersion ?? '', 10);
        const version = Number.isInteger(versionIndex) && post.versions?.[versionIndex]
          ? post.versions[versionIndex]
          : post;
        const line = document.createElement('div');
        line.textContent = `${post.publishedAt ?? 'Unknown date'} · ${localized(version.title, language) || post.platform}`;
        footer.append(line);
      }

      if (contextType === 'artworkVersion') {
        const artwork = index.artworks[media.artworkId];
        if (artwork) {
          const line = document.createElement('div');
          line.textContent = `${localized(artwork.title, language) || artwork.id} · ${media.versionId}`;
          footer.append(line);
        }
      }

      for (const postId of media.postIds ?? []) {
        const post = index.posts[postId];
        if (!post) continue;

        const line = document.createElement('div');
        const link = document.createElement('a');
        link.href = post.href || '#';
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = `${post.publishedAt ?? 'Unknown date'} · ${post.platform}${post.status === 'deleted' ? ' · deleted' : ''}`;
        line.append(link);
        footer.append(line);
      }
    } catch (error) {
      console.error('Could not render MediaViewer metadata.', error);
    }
  }

  function tryPixelateImage(image) {
    if (!image?.matches?.('img')) return;
    const update = () => {
      const pixelate =
        image.naturalWidth <= image.clientWidth / 2 &&
        image.naturalHeight <= image.clientHeight / 2;

      image.classList.toggle('pixelated', pixelate);
    };

    if (image.complete && image.naturalWidth > 0) {
      update();
    } else {
      image.addEventListener('load', update, { once: true });
    }
  }

  function showFullSizeCopy(sourceElement, viewer) {
    const media = sourceElement.cloneNode(true);
    media.removeAttribute('onclick');
    media.removeAttribute('style');
    media.classList.remove('clickable');
    media.classList.add('media-viewer-current');

    const videos = media.matches('video')
      ? [media]
      : [...media.querySelectorAll('video')];

    for (const video of videos) {
      video.autoplay = true;
      video.play?.().catch(() => {
        // Browsers may block autoplay when the video is not muted.
      });
    }

    const container = document.querySelector('#mediaModalContent');
    if (!container) return;

    container.replaceChildren(media);

    const image = media.matches('img') ? media : media.querySelector('img');
    if (image) tryPixelateImage(image);
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

    const provider = new PageMediaProvider('[data-paged-list]');
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
