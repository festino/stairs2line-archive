(() => {
  const storagePrefix = 'archive-profile-version:';

  function storedValue(platformId) {
    try {
      return localStorage.getItem(`${storagePrefix}${platformId}`);
    } catch {
      return null;
    }
  }

  function storeValue(platformId, value) {
    try {
      localStorage.setItem(`${storagePrefix}${platformId}`, value);
    } catch {
      // Storage is optional; switching still works for the current page.
    }
  }

  function applyVersion(hero, value) {
    const panels = [...hero.querySelectorAll('[data-profile-version-panel]')];
    const selected = panels.find((panel) => panel.dataset.profileVersionPanel === value) ?? panels.at(-1);
    if (!selected) return;

    for (const panel of panels) panel.hidden = panel !== selected;
    hero.classList.toggle('platform-hero--no-banner', selected.dataset.profileBannerAbsent === 'true');

    const select = hero.querySelector('[data-profile-version-select]');
    if (select) select.value = selected.dataset.profileVersionPanel;
  }

  for (const hero of document.querySelectorAll('[data-profile-version-platform]')) {
    const select = hero.querySelector('[data-profile-version-select]');
    if (!select) continue;

    const toolbar = hero.querySelector('.platform-profile-version-toolbar');
    if (toolbar) toolbar.hidden = false;

    const platformId = hero.dataset.profileVersionPlatform;
    const saved = storedValue(platformId);
    if (saved !== null) applyVersion(hero, saved);

    select.addEventListener('change', () => {
      applyVersion(hero, select.value);
      storeValue(platformId, select.value);
    });
  }
})();
