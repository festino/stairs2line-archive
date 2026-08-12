export function localizedValue(value, language, fallbackLanguage = null) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);
  return value[language]
    ?? value.default
    ?? (fallbackLanguage ? value[fallbackLanguage] : null)
    ?? Object.values(value).find((item) => typeof item === 'string' && item.length > 0)
    ?? null;
}

export function formatDate(value, language, options = {}) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const hasTime = String(value).includes('T');
  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: options.month ?? 'long',
    day: 'numeric',
    ...(hasTime && options.includeTime !== false
      ? { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
      : {}),
    timeZone: 'UTC'
  }).format(date);
}

export function localeText(locales, language, key, replacements = {}) {
  const segments = key.split('.');
  let value = locales[language];
  for (const segment of segments) value = value?.[segment];
  if (typeof value !== 'string') value = key;
  return value.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => String(replacements[name] ?? `{${name}}`));
}
