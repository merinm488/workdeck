// Only Holm owns sessions. Sign out with its same-origin cookie endpoint.
const todoAuth = {
  async logout() {
    try {
      const response = await (window.WDBoot?.fetch || fetch)('/auth/logout', {
        method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Sign out failed.');
      window.location.assign('/');
    } catch (_) {
      alert('Could not sign out. Please try again.');
    }
  },
};
