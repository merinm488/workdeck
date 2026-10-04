/**
 * Filebox PWA registration.
 *
 * Registers the Filebox service worker at the /filebox/ scope, offers the
 * update banner when a new worker is waiting, captures the install prompt,
 * and keeps the theme-color meta tag in sync with the active theme.
 */
(function () {
  'use strict';

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    // Service workers require a secure context (or localhost for dev).
    if (location.protocol !== 'https:' &&
        location.hostname !== 'localhost' &&
        location.hostname !== '127.0.0.1') {
      return;
    }

    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('/filebox/service-worker.js', { scope: '/filebox/' })
        .then(function (registration) {
          // A waiting worker means a new deploy is ready — offer it.
          registration.addEventListener('updatefound', function () {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', function () {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner();
              }
            });
          });
        })
        .catch(function (error) {
          console.error('[PWA] Service worker registration failed:', error);
        });
    });
  }

  function showUpdateBanner() {
    if (document.getElementById('fbPwaBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'fbPwaBanner';
    banner.className = 'fb-pwa-banner';
    banner.innerHTML = '<span>A new version is available</span>';

    const reload = document.createElement('button');
    reload.textContent = 'Reload';
    reload.addEventListener('click', function () {
      navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        window.location.reload();
      }, { once: true });
    });

    const dismiss = document.createElement('button');
    dismiss.className = 'dismiss';
    dismiss.textContent = '×';
    dismiss.addEventListener('click', function () {
      banner.remove();
    });

    banner.appendChild(reload);
    banner.appendChild(dismiss);
    document.body.appendChild(banner);
  }

  function captureInstallPrompt() {
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;

      if (document.getElementById('fbInstallBtn')) return;
      const btn = document.createElement('button');
      btn.id = 'fbInstallBtn';
      btn.className = 'fb-pwa-banner';
      btn.textContent = 'Install Filebox';
      btn.addEventListener('click', async function () {
        btn.remove();
        deferredPrompt.prompt();
        await deferredPrompt.userChoice.catch(function () {});
        deferredPrompt = null;
      });
      document.body.appendChild(btn);
    });
  }

  function setupThemeColor() {
    var updateThemeColor = function () {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) return;

      var theme = document.documentElement.getAttribute('data-theme');
      var isDark = theme === 'dark' ||
        (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      meta.setAttribute('content', isDark ? '#0b1220' : '#0d9488');
    };

    updateThemeColor();

    // themes.js sets data-theme on <html>; re-run whenever it changes.
    var observer = new MutationObserver(updateThemeColor);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class']
    });
  }

  registerServiceWorker();
  captureInstallPrompt();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupThemeColor);
  } else {
    setupThemeColor();
  }
})();
