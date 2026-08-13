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

  function install() {
    if (typeof window.MediaViewer !== 'function' || typeof window.jQuery !== 'function') return;
    let modal = document.querySelector('#mediaModal');
    if (!modal) {
      $('body').append(`
            <div class="modal" id="mediaModal" tabindex="-1" aria-hidden="true" style="align-content: center;">
                <div class="modal-dialog" style="max-width: unset; margin: auto;">
                    <div id="mediaModalContent" class="fullsize-media fit-media fit-media-copyable">
                    </div>
                </div>
                <div class="modal-subtext"></div>
                <div class="media-viewer-switcher media-viewer-switcher-left hidden"><span>&lt;</span></div>
                <div class="media-viewer-switcher media-viewer-switcher-right hidden"><span>&gt;</span></div>
            </div>`);
      modal = document.querySelector('#mediaModal');
    }
    const provider = new PageMediaProvider('[data-paged-list]');
    const viewer = new window.MediaViewer('#mediaModal', (element) => {
      if (typeof window.showFullSizeCopy === 'function') window.showFullSizeCopy(element);
      updateFooter(element);
    });

    document.addEventListener('click', (event) => {
      const link = event.target.closest('.media-link');
      const media = link?.querySelector('[data-viewer-media]');
      if (!media) return;
      event.preventDefault();
      viewer.show(media, provider);
    });

    window.stairs2lineMediaViewer = viewer;
    window.stairs2lineMediaProvider = provider;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
