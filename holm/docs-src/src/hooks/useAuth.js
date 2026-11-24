import { useState, useCallback } from 'react';

// Holm owns the sign-in cookie. The sentinel is only used to enable Docs'
// existing React hooks; it is never a member ID or an API credential.
export function useAuth() {
  const [userHash, setUserHash] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const checkSession = useCallback(async () => {
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Could not check your session.');
      const session = await response.json();
      setUserHash(session.member ? 'holm-session' : null);
      setIsAuthenticated(!!session.member);
      setError(null);
      return !!session.member;
    } catch (_) {
      setError('Could not check your session. Please refresh.');
      setUserHash(null); setIsAuthenticated(false);
      return false;
    } finally { setIsLoading(false); }
  }, []);
  const login = useCallback(() => { location.assign('/auth/login?redirect=%2Fdocs%2F'); }, []);
  const logout = useCallback(async () => {
    try {
      const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin',
        headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Could not sign out');
      setUserHash(null); setIsAuthenticated(false);
      location.assign('/');
    } catch (_) { setError('Could not sign out. Please try again.'); }
  }, []);
  return { userHash, isAuthenticated, isLoading, error, errorCode: null,
    login, createAccount: login, logout, deleteAccount: () => ({ success: false }),
    checkSession, getUserKey: () => null };
}
