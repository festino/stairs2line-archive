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
      this.isSubscribed = false;

      this.leftSwitcher = this.modal.querySelector('.media-viewer-switcher-left');
      this.rightSwitcher = this.modal.querySelector('.media-viewer-switcher-right');

      this.onKeyDown = this.onKeyDown.bind(this);
      this.onWheel = this.onWheel.bind(this);
      this.onBackdropClick = this.onBackdropClick.bind(this);
      this.onLeftClick = this.onClick.bind(this, 'prev');
      this.onRightClick = this.onClick.bind(this, 'next');
    }

    show(element, mediaProvider) {
      if (!this.modal) return;

      if (!this.isSubscribed) {
        this.subscribe();
        this.isSubscribed = true;
      }

      this.mediaProvider = mediaProvider;
      this.renderMedia(element);
      this.open();

      mediaProvider.getPrev(element, (prev) => {
        this.prev = prev;
        this.leftSwitcher?.classList.toggle('hidden', !prev);
      });

      mediaProvider.getNext(element, (next) => {
        this.next = next;
        this.rightSwitcher?.classList.toggle('hidden', !next);
      });
    }

    open() {
      this.modal.hidden = false;
      this.modal.style.display = 'block';
      this.modal.setAttribute('aria-hidden', 'false');
      this.modal.classList.add('show');
      document.body.classList.add('modal-open');
      this.modal.focus({ preventScroll: true });
    }

    close() {
      if (!this.modal || this.modal.getAttribute('aria-hidden') === 'true') return;

      this.modal.classList.remove('show');
      this.modal.style.display = 'none';
      this.modal.hidden = true;
      this.modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');

      this.unsubscribe();
      this.isSubscribed = false;
      this.mediaProvider = null;
      this.prev = null;
      this.next = null;

      this.leftSwitcher?.classList.add('hidden');
      this.rightSwitcher?.classList.add('hidden');
    }

    canSwitch() {
      return typeof window.hasModalUnsaved !== 'function' || !window.hasModalUnsaved(this.modal);
    }

    subscribe() {
      document.addEventListener('keydown', this.onKeyDown);
      document.addEventListener('wheel', this.onWheel, { passive: false });
      this.modal.addEventListener('click', this.onBackdropClick);
      this.leftSwitcher?.addEventListener('click', this.onLeftClick);
      this.rightSwitcher?.addEventListener('click', this.onRightClick);
    }

    unsubscribe() {
      document.removeEventListener('keydown', this.onKeyDown);
      document.removeEventListener('wheel', this.onWheel);
      this.modal.removeEventListener('click', this.onBackdropClick);
      this.leftSwitcher?.removeEventListener('click', this.onLeftClick);
      this.rightSwitcher?.removeEventListener('click', this.onRightClick);
    }

    onBackdropClick(event) {
      if (event.target === this.modal && this.canSwitch()) {
        this.close();
      }
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
      if (!this.canSwitch()) return;

      if (event.deltaY > 0 && this.next) {
        event.preventDefault();
        this.show(this.next, this.mediaProvider);
      } else if (event.deltaY < 0 && this.prev) {
        event.preventDefault();
        this.show(this.prev, this.mediaProvider);
      }
    }

    onClick(direction, event) {
      event.stopPropagation();
      if (!this.canSwitch()) return;

      if (direction === 'next' && this.next) {
        this.show(this.next, this.mediaProvider);
      } else if (direction === 'prev' && this.prev) {
        this.show(this.prev, this.mediaProvider);
      }
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

      const language = document.documentElement.lang || 'ru';
      const contextType = element.dataset.contextType;
      const contextId = element.dataset.contextId;

      if (contextType === 'post' && index.posts[contextId]) {
        const post = index.posts[contextId];
        const line = document.createElement('div');
        line.textContent = `${post.publishedAt ?? 'Unknown date'} · ${localized(post.title, language) || post.platform}`;
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
    if (image) {
      tryPixelateImage(image);
      image.addEventListener('click', () => viewer.close(), { once: true });
    }
  }

  function createModal() {
    let modal = document.querySelector('#mediaModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal" id="mediaModal" tabindex="-1" aria-hidden="true" hidden style="align-content: center;">
        <div class="modal-dialog" style="max-width: unset; margin: auto;">
          <div id="mediaModalContent" class="fullsize-media fit-media fit-media-copyable"></div>
        </div>
        <div class="modal-subtext"></div>
        <div class="media-viewer-switcher media-viewer-switcher-left hidden"><span>&lt;</span></div>
        <div class="media-viewer-switcher media-viewer-switcher-right hidden"><span>&gt;</span></div>
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
      updateFooter(element);
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
