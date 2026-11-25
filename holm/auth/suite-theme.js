/* Apply the suite preference before first paint. Each app retains its existing
   server persistence and interactive theme controls; this only prevents a flash
   of a different palette while those adapters load. */
(() => {
  let preference = 'dark';
  try { preference = localStorage.getItem('workdeck_theme') || 'dark'; } catch (_) {}
  if (!['light', 'dark', 'system'].includes(preference)) preference = 'dark';
  const effective = preference === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  document.documentElement.dataset.theme = effective;
  if (document.documentElement.dataset.wdApp === 'docs') {
    document.documentElement.classList.toggle('dark', effective === 'dark');
  }
})();
