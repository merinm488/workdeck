// Holm owns sign-in for every Workdeck app. No legacy key/hash mirrors.
const kanbanAuth = {
  async verifySession() {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      return response.ok && !!(await response.json()).member;
    } catch (_) { return false; }
  },
  async logout() {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/auth/logout', {
        method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Sign out failed');
      location.assign('/');
    } catch (_) { alert('Could not sign out. Please try again.'); }
  },
};
