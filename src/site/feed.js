(() => {
  const activityMonths = [...document.querySelectorAll('details.activity-month')];

  function positionActivityPopover(details) {
    const popover = details.querySelector('.activity-popover');
    if (!popover) return;

    // Position the popover before the details element is opened. The left
    // coordinate is calculated directly instead of opening in the default
    // place and correcting it a frame later; this avoids both edge overflow
    // and the visible "slide" on narrow screens.
    const anchor = details.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportWidth = visualViewport?.width ?? document.documentElement.clientWidth;
    const viewportRight = viewportLeft + viewportWidth;
    const gutter = 16;
    const popoverWidth = Math.min(360, Math.max(0, viewportWidth - gutter * 2));
    const centeredLeft = anchor.left + anchor.width / 2 - popoverWidth / 2;
    const minLeft = viewportLeft + gutter;
    const maxLeft = Math.max(minLeft, viewportRight - gutter - popoverWidth);
    const clampedLeft = Math.min(maxLeft, Math.max(minLeft, centeredLeft));

    popover.style.left = `${Math.round(clampedLeft - anchor.left)}px`;
    popover.style.right = 'auto';
  }

  for (const details of activityMonths) {
    const summary = details.querySelector('summary');
    if (!summary) continue;

    summary.addEventListener('click', (event) => {
      // Native <details> toggling happens after the click. Handle it ourselves
      // so a newly opened popover already has its final position on its very
      // first painted frame. Keyboard activation of <summary> also fires click.
      event.preventDefault();
      if (details.open) {
        details.open = false;
        return;
      }

      for (const other of activityMonths) {
        if (other !== details && other.open) other.open = false;
      }
      positionActivityPopover(details);
      details.open = true;
    });
  }

  const repositionOpenActivityPopover = () => {
    const open = activityMonths.find((details) => details.open);
    if (open) positionActivityPopover(open);
  };
  window.addEventListener('resize', repositionOpenActivityPopover, { passive: true });
  window.visualViewport?.addEventListener('resize', repositionOpenActivityPopover, { passive: true });
  window.visualViewport?.addEventListener('scroll', repositionOpenActivityPopover, { passive: true });

  const STORAGE_KEY = 'stairs2line.archive.listMode';
  const list = document.querySelector('[data-paged-list]');
  const pagination = document.querySelector('[data-pagination]');
  const toggle = document.querySelector('[data-feed-toggle]');
  const sentinel = document.querySelector('[data-feed-sentinel]');
  if (!list || !toggle) return;

  let loading = false;
  let loadingPromise = null;
  let nextUrl = pagination?.querySelector('a[rel="next"]')?.href ?? null;
  let observer = null;

  function currentMode() {
    const parameter = new URL(location.href).searchParams.get('mode');
    if (parameter === 'feed' || parameter === 'pages') return parameter;
    return localStorage.getItem(STORAGE_KEY) ?? 'pages';
  }

  function setButton(mode) {
    toggle.textContent = mode === 'feed' ? toggle.dataset.feedLabel : toggle.dataset.pagesLabel;
    toggle.setAttribute('aria-pressed', String(mode === 'feed'));
  }

  function loadNextPage() {
    if (loadingPromise) return loadingPromise;
    if (!nextUrl) return Promise.resolve(false);

    loading = true;
    const status = document.createElement('div');
    status.className = 'feed-loading';
    status.textContent = '…';
    sentinel?.before(status);

    loadingPromise = (async () => {
      try {
        const response = await fetch(nextUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const nextList = parsed.querySelector('[data-paged-list]');
        const nextLink = parsed.querySelector('[data-pagination] a[rel="next"]');
        if (!nextList) throw new Error('The next page does not contain a paged list.');

        for (const child of [...nextList.children]) {
          const dedupeKey = child.dataset.feedDedupeKey;
          if (dedupeKey && [...list.querySelectorAll('[data-feed-dedupe-key]')].some((item) => item.dataset.feedDedupeKey === dedupeKey)) continue;
          list.append(child);
        }
        nextUrl = nextLink?.href ?? null;
        if (!nextUrl) observer?.disconnect();
        document.dispatchEvent(new CustomEvent('archive:feed-appended'));
        return true;
      } catch (error) {
        console.error('Could not append the next archive page.', error);
        observer?.disconnect();
        return false;
      } finally {
        status.remove();
        loading = false;
        loadingPromise = null;
      }
    })();

    return loadingPromise;
  }

  function enableFeed() {
    if (!sentinel) return;
    pagination?.setAttribute('hidden', '');
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadNextPage();
    }, { rootMargin: '900px 0px' });
    observer.observe(sentinel);
  }

  function disableFeed() {
    observer?.disconnect();
    pagination?.removeAttribute('hidden');
  }

  function applyMode(mode) {
    localStorage.setItem(STORAGE_KEY, mode);
    setButton(mode);
    if (mode === 'feed') enableFeed();
    else disableFeed();
  }

  toggle.addEventListener('click', () => {
    applyMode(currentMode() === 'feed' ? 'pages' : 'feed');
  });

  window.Stairs2lineArchiveFeed = {
    get mode() {
      return currentMode();
    },
    hasNext() {
      return Boolean(nextUrl);
    },
    loadNextPage
  };

  applyMode(currentMode());
})();
