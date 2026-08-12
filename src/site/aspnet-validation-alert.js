(() => {
  const target = document.querySelector('#archive-validation-alert');
  if (!target) return;

  fetch('/api/stairs2line/archive-validation', { credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((result) => {
      if (!result || result.isValid) return;
      target.hidden = false;
      target.textContent = `Archive files are out of sync: ${result.missingOnDisk.length} missing on disk, ${result.unlistedOnDisk.length} unlisted.`;
    })
    .catch(() => {
      // GitHub Pages and other static hosts do not expose the ASP.NET validation endpoint.
    });
})();
