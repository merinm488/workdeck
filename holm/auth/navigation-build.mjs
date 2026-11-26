import { readFileSync } from 'node:fs';
import { withPageTitle } from './page-title-build.mjs';
const boot = readFileSync(new URL('./page-boot.js', import.meta.url), 'utf8');

// All ordered classic scripts download in parallel without blocking the shell.
// Theme/route bootstraps remain synchronous; inert iframe templates are untouched.
export function withPageBoot(page) {
  const app = /data-wd-app="([a-z]+)"/.exec(page)?.[1];
  if (!app) return page;
  page = withPageTitle(page, app);
  page = page.replace(/<template\b[\s\S]*?<\/template>|<textarea\b[\s\S]*?<\/textarea>|<script\b[^>]*>[\s\S]*?<\/script>|<link\b[^>]*>/g, tag => {
    if (tag.startsWith('<link') && /fonts\.(?:googleapis|gstatic)\.com/.test(tag)) return '';
    if (app === 'docs' || !tag.startsWith('<script') || !/\bsrc=/.test(tag) || /\b(?:defer|async|type)=?|suite-theme\.js/.test(tag)) return tag;
    return tag.replace('<script', '<script defer');
  });
  // Multi-view apps must choose home vs. detail before revealing either one.
  // Their existing showHome/showEditor routines unhide only the intended view.
  if (app === 'todo') page = page.replace('<div id="listsView">', '<div id="listsView" class="hidden">');
  if (app === 'blog') page = page.replace('id="postsView" class="blog-page"', 'id="postsView" class="blog-page hidden"');
  if (app === 'minutes') page = page.replace('id="home" class="home"', 'id="home" class="home hidden"');
  return page.replace('<head>', `<head><script data-wd-boot>${boot}</script><style>@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url('/fonts/InterVariable.woff2') format('woff2')}</style>`);
}
