// Holm verifies the cookie on every API request; this is only UI chrome.
const authManager = {
  isAuthenticated() { return true; }, // Never an authorization decision.
  async verifySession() {
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return false;
      const session = await response.json();
      if (!session.member) return false;
      const theme = session.member.theme;
      if (['dark', 'light', 'system'].includes(theme)) localStorage.setItem('workdeck_theme', theme);
      return true;
    } catch (_) { return false; }
  },
  async logout() {
    try {
      const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin',
        headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Sign out failed');
      location.assign('/');
      return { success: true };
    } catch (_) { alert('Could not sign out. Please try again.'); return { success: false }; }
  },
};
