// Holm-only: present one account menu across the migrated apps while preserving
// each app's existing theme and sign-out handlers.
(() => {
  const icons = {
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    dark: '<path d="M20.5 15.5A9 9 0 0 1 8.5 3.5a9 9 0 1 0 12 12Z"/>',
    system: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8m-4-3v3"/>'
  };
  const init = () => {
    const menu = document.getElementById('settingsDropdown') || document.getElementById('fbSettingsDropdown') || document.getElementById('settingsMenu');
    const trigger = document.getElementById('settingsBtn') || document.getElementById('fbSettingsBtn');
    if (!menu || !trigger) return;
    menu.classList.add('wd-account-panel');
    trigger.classList.add('wd-account-trigger');
    trigger.setAttribute('aria-label', 'Settings');
    trigger.setAttribute('title', 'Settings');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-controls', menu.id);
    const positionMenu = () => menu.style.setProperty('--wd-menu-top', `${Math.round(trigger.getBoundingClientRect().bottom + 8)}px`);
    trigger.addEventListener('click', positionMenu);
    window.addEventListener('resize', positionMenu);

    // Only hide the original controls; their JS listeners still handle persistence
    // and server-side preference updates when the new choices forward a click.
    const legacy = menu.querySelector('.wd-theme-container, .theme-dropdown-container, .fb-theme-container, .blog-theme-wrap');
    if (legacy) {
      legacy.classList.add('wd-legacy-theme');
      const row = document.createElement('div');
      row.className = 'wd-theme-setting';
      row.setAttribute('aria-label', 'Theme');
      row.innerHTML = '<span>Theme</span><div class="wd-theme-options" role="group" aria-label="Theme preference"></div>';
      const options = row.querySelector('.wd-theme-options');
      const sync = () => {
        let pref;
        try { pref = localStorage.getItem('workdeck_theme'); } catch (_) {}
        if (!['light', 'dark', 'system'].includes(pref)) pref = 'dark';
        options.querySelectorAll('button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.theme === pref)));
      };
      for (const theme of ['light', 'dark', 'system']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wd-theme-choice';
        button.dataset.theme = theme;
        button.setAttribute('aria-label', theme[0].toUpperCase() + theme.slice(1) + ' theme');
        button.title = button.getAttribute('aria-label');
        button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[theme]}</svg>`;
        button.addEventListener('click', event => {
          event.stopPropagation();
          legacy.querySelector(`[data-theme="${theme}"]`)?.click();
          // Some apps update storage asynchronously; reflect the choice immediately.
          options.querySelectorAll('button').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
        });
        options.append(button);
      }
      legacy.before(row);
      sync();
      window.addEventListener('storage', e => { if (e.key === 'workdeck_theme') sync(); });
      trigger.addEventListener('click', sync);
    }
    // App-specific item icons were inconsistent. Keep all actions text-only,
    // including the Holm "Your sign-ins" link.
    // Todo predates account management; expose the same Holm destination here.
    if (!menu.querySelector('a[href^="/auth/account"]')) {
      const account = document.createElement('a');
      account.href = '/auth/account?redirect=%2Fhome';
      account.textContent = 'Your sign-ins';
      account.className = 'wd-account-item';
      (menu.querySelector('#logoutBtn, #fbLogoutBtn') || menu).before(account);
    }
    menu.querySelectorAll('a[href^="/auth/account"]').forEach(link => link.classList.add('wd-account-item'));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
