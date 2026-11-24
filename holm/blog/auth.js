// The Holm session cookie is the only Blog credential.
const blogAuth = {
    async verifySession() {
        try {
            const response = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
            const data = await response.json();
            if (!data.member) return false;
            if (['light', 'dark', 'system'].includes(data.member.theme))
                localStorage.setItem('workdeck_theme', data.member.theme);
            return true;
        } catch (_) { return false; }
    },
    async logout() {
        try {
            const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin',
                headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error('Sign out failed');
            location.assign('/');
        } catch (_) { alert('Could not sign out. Please try again.'); }
    }
};
