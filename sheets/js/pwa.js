/**
 * PWA Manager - Handles Progressive Web App functionality
 * Includes service worker registration, install prompts, and app lifecycle
 */

class PWAManager {
  constructor() {
    this.deferredPrompt = null;
    this.swRegistration = null;
    this.isUpdateAvailable = false;
  }

  /**
   * Initialize PWA functionality
   */
  async init() {
    this.registerServiceWorker();
    this.setupInstallPrompt();
    this.setupAppLifecycle();
    this.setupThemeColor();
  }

  /**
   * Register the service worker
   */
  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        // Check if we're on a secure context or localhost
        if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
          console.warn('[PWA] Service Workers require HTTPS or localhost');
          return;
        }

        // Register service worker with update detection
        const registration = await navigator.serviceWorker.register('/sheets/service-worker.js', {
          scope: '/sheets/'
        });

        this.swRegistration = registration;

        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available
              this.isUpdateAvailable = true;
              this.showUpdateNotification();
            }
          });
        });

        // Request sync for background tasks
        if ('sync' in registration) {
          registration.sync.register('sync-spreadsheets').catch(err => {
            // Sync registration failed - not critical
          });
        }

        // Listen for messages from service worker
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data.type === 'SYNC_DATA') {
            // Trigger data sync with your storage manager
            if (window.storageManager) {
              window.storageManager.syncData();
            }
          }
        });

      } catch (error) {
        console.error('[PWA] Service Worker registration failed:', error);
      }
    } else {
      console.warn('[PWA] Service Workers not supported in this browser');
    }
  }

  /**
   * Set up install prompt handling
   */
  setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent the mini-infobar from appearing
      e.preventDefault();

      // Store the event for later use
      this.deferredPrompt = e;
    });

    // Handle successful installation
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.showInstallSuccess();
    });
  }

  /**
   * Prompt user to install the PWA (can be called manually if needed)
   */
  async promptInstall() {
    if (!this.deferredPrompt) {
      return false;
    }

    try {
      // Show the install prompt
      this.deferredPrompt.prompt();

      // Wait for user response
      const { outcome } = await this.deferredPrompt.userChoice;

      // Clear the deferred prompt
      this.deferredPrompt = null;

      return outcome === 'accepted';
    } catch (error) {
      console.error('[PWA] Install prompt error:', error);
      return false;
    }
  }

  /**
   * Show update notification
   */
  showUpdateNotification() {
    const notification = document.createElement('div');
    notification.className = 'pwa-update-notification';

    const content = document.createElement('div');
    content.className = 'notification-content';
    const label = document.createElement('span');
    label.textContent = 'A new version is available!';
    const actions = document.createElement('div');
    actions.className = 'notification-actions';
    const updateBtn = document.createElement('button');
    updateBtn.className = 'update-btn';
    updateBtn.textContent = 'Update';
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'dismiss-btn';
    dismissBtn.textContent = 'Later';
    actions.append(updateBtn, dismissBtn);
    content.append(label, actions);
    notification.append(content);

    document.body.appendChild(notification);

    updateBtn.addEventListener('click', () => {
      this.activateUpdate();
      notification.remove();
    });

    dismissBtn.addEventListener('click', () => notification.remove());

    // Auto-hide after 30 seconds
    setTimeout(() => notification.remove(), 30000);
  }

  /**
   * Activate service worker update
   */
  async activateUpdate() {
    if (this.swRegistration && this.swRegistration.waiting) {
      // Send message to waiting service worker to skip waiting
      this.swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });

      // Reload once the new service worker activates
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }
  }

  /**
   * Show installation success message
   */
  showInstallSuccess() {
    const notification = document.createElement('div');
    notification.className = 'pwa-success-notification';

    const content = document.createElement('div');
    content.className = 'notification-content';
    const label = document.createElement('span');
    label.textContent = '✓ App installed successfully!';
    content.append(label);
    notification.append(content);

    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
  }

  /**
   * Set up app lifecycle listeners
   */
  setupAppLifecycle() {
    // Handle visibility change
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        // Refresh data when app becomes visible
        this.refreshData();
      }
    });

    // Handle beforeunload
    window.addEventListener('beforeunload', () => {
      // Save any pending data
      this.savePendingData();
    });

    // Handle online/offline status
    window.addEventListener('online', () => {
      this.showOnlineStatus();
    });

    window.addEventListener('offline', () => {
      this.showOfflineStatus();
    });
  }

  /**
   * Refresh data when app becomes visible
   */
  refreshData() {
    // Trigger data refresh through your storage manager
    if (window.storageManager) {
      window.storageManager.refreshSpreadsheets();
    }
  }

  /**
   * Save pending data before closing
   */
  savePendingData() {
    // Save any pending changes
    if (window.storageManager) {
      window.storageManager.savePendingChanges();
    }
  }

  /**
   * Show online status
   */
  showOnlineStatus() {
    const status = document.getElementById('connection-status');
    if (status) {
      status.textContent = 'Online';
      status.className = 'connection-status online';
    }
  }

  /**
   * Show offline status
   */
  showOfflineStatus() {
    const status = document.getElementById('connection-status');
    if (status) {
      status.textContent = 'Offline';
      status.className = 'connection-status offline';
    }
  }

  /**
   * Set up dynamic theme color
   */
  setupThemeColor() {
    // Update theme-color meta tag based on current theme
    const updateThemeColor = () => {
      const isDark = document.documentElement.classList.contains('dark-theme') ||
                     document.documentElement.classList.contains('dark');
      const themeColor = isDark ? '#1a1a1a' : '#4F46E5';

      let metaTag = document.querySelector('meta[name="theme-color"]');
      if (!metaTag) {
        metaTag = document.createElement('meta');
        metaTag.name = 'theme-color';
        document.head.appendChild(metaTag);
      }
      metaTag.content = themeColor;
    };

    // Initial setup
    updateThemeColor();

    // Listen for theme changes
    const observer = new MutationObserver(updateThemeColor);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  /**
   * Check if app is installed
   */
  isInstalled() {
    // Check if running as standalone PWA
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  /**
   * Get app info
   */
  getAppInfo() {
    return {
      isInstalled: this.isInstalled(),
      isOnline: navigator.onLine,
      serviceWorker: !!this.swRegistration,
      updateAvailable: this.isUpdateAvailable,
      userAgent: navigator.userAgent
    };
  }
}

// Initialize PWA manager
const pwaManager = new PWAManager();

// Export for use in other scripts
window.pwaManager = pwaManager;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => pwaManager.init());
} else {
  pwaManager.init();
}
