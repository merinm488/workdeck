// Render account avatars at build time so no page flashes the old settings gear.
// The shoulders start at y=15, below the head's y=12 edge (including stroke).
export const accountAvatar = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>';

export function withProfilePhotos(html) {
  const head = html.replace('</head>', '<link rel="stylesheet" href="/profile-photo.css"></head>');
  const end = head.lastIndexOf('</body>');
  if (end < 0) throw new Error('Missing body for profile photos');
  return head.slice(0, end) + '<script defer src="/js/profile-photo.js"></script>' + head.slice(end);
}

export function withAccountAvatars(html) {
  return html.replace(/<button\b[^>]*\bid="(?:settingsBtn|fbSettingsBtn|landingMenuToggle)"[^>]*>[\s\S]*?<\/button>/g, button => {
    let opening = button.slice(0, button.indexOf('>'))
      .replace(/\s(?:aria-label|title)="[^"]*"/g, '');
    // Static app buttons need their shared styling before the menu script runs.
    // Landing uses its equivalent lp-account-toggle styling and palette.
    if (!opening.includes('id="landingMenuToggle"')) {
      opening = opening.replace(/class="([^"]*)"/, (_, classes) =>
        `class="${[...new Set([...classes.split(/\s+/), 'wd-account-trigger'])].join(' ')}"`);
      if (!opening.includes('class="')) opening += ' class="wd-account-trigger"';
    }
    return `${opening} aria-label="Account menu" title="Account menu">${accountAvatar}</button>`;
  });
}

// The Docs editor inherits its menu from the legacy tree; change only the
// trigger, leaving its theme/tag/share actions and event handlers intact.
export function withDocsAccountAvatar(source) {
  const trigger = /(<button\s+ref=\{buttonRef\}[\s\S]*?>)\s*<svg[\s\S]*?<\/svg>/;
  if (!trigger.test(source)) throw new Error('Docs account trigger no longer matches');
  const jsx = accountAvatar.replace('stroke-width', 'strokeWidth').replace('stroke-linecap', 'strokeLinecap').replace('stroke-linejoin', 'strokeLinejoin');
  return source.replace(trigger, (_, opening) => opening
    .replace(/className=\{`[^`]*`\}/, 'className="wd-account-trigger"')
    .replace('aria-label="Settings"', 'aria-label="Account menu" aria-haspopup="true"')
    .replace('title="Settings"', 'title="Account menu"') + jsx);
}
