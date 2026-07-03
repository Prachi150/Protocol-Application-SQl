export const APP_BASE: string = (() => {
  if (typeof window === 'undefined') return '';
  const m = window.location.pathname.match(/^.*\/apps\/[^/]+\//);
  if (m) return m[0].replace(/\/$/, '');
  return '';
})();
