(() => {
  const STORAGE_KEY = 'archive-theme';
  const root = document.documentElement;
  const toggle = document.querySelector('[data-theme-toggle]');
  if (!toggle) return;

  const lightLabel = toggle.dataset.lightLabel || 'Light';
  const darkLabel = toggle.dataset.darkLabel || 'Dark';

  function currentTheme() {
    return root.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function remember(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // The switch still works for the current page if storage is unavailable.
    }
  }

  function render(theme) {
    if (theme === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    toggle.textContent = theme === 'dark' ? darkLabel : lightLabel;
    toggle.setAttribute('aria-checked', String(theme === 'dark'));
  }

  toggle.hidden = false;
  render(currentTheme());
  toggle.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    render(next);
    remember(next);
  });
})();
