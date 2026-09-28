import { useState, useCallback } from 'react';
import { generateHash, isValidKey, normalizeKey } from '../lib/cryptoUtils';

/**
 * Authentication Hook
 * Manages login, account creation via TextDB API
 */
export function useAuth() {
  // Initialize synchronously from sessionStorage so a returning user's first
  // paint is the app itself — no login-screen flash, and no splash gate while
  // the session is checked. checkSession() verifies the hash with the server
  // in the background and clears the session if it is no longer valid.
  const [userHash, setUserHash] = useState(
    () => sessionStorage.getItem('docs_hash') || sessionStorage.getItem('docs_hash')
  );
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => Boolean(sessionStorage.getItem('docs_hash') || sessionStorage.getItem('docs_hash'))
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);

  /**
   * Login with a custom key (existing account only)
   * @param {string} key - The user's custom key
   * @returns {Promise<Object>} - Login result { success, error }
   */
  const login = useCallback(async (key) => {
    setIsLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const normalizedKey = normalizeKey(key);

      if (!isValidKey(normalizedKey)) {
        setError('Key cannot be empty');
        setErrorCode('INVALID_FORMAT');
        setIsLoading(false);
        return { success: false, error: 'Invalid key format' };
      }

      // Send the key to server for hashing and authentication
      const response = await fetch('/api/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: normalizedKey, action: 'login' })
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 404) {
          // User doesn't exist - automatically create account
          setIsLoading(false);
          return createAccount(key);
        }

        throw new Error(data.error || 'Login failed');
      }

      // User exists - set session and login
      setUserHash(data.hash);
      setIsAuthenticated(true);
      setSessionKeys(data.hash, normalizedKey);

      setIsLoading(false);
      return {
        success: true,
        message: 'Welcome back!',
        isNewAccount: false
      };

    } catch (err) {
      setError('Login failed. Please try again.');
      setErrorCode('LOGIN_ERROR');
      setIsLoading(false);
      return { success: false, error: err.message };
    }
  }, []);

  /**
   * Create a new account with a custom key
   * @param {string} key - The user's custom key
   * @returns {Promise<Object>} - Creation result { success, error }
   */
  const createAccount = useCallback(async (key) => {
    setIsLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const normalizedKey = normalizeKey(key);

      if (!isValidKey(normalizedKey)) {
        setError('Key cannot be empty');
        setErrorCode('INVALID_FORMAT');
        setIsLoading(false);
        return { success: false, error: 'Invalid key format' };
      }

      // Create account via API
      const response = await fetch('/api/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: normalizedKey, action: 'create' })
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === 'USER_EXISTS') {
          setError('An account with this key already exists');
          setErrorCode('USER_EXISTS');
        } else {
          setError(data.error || 'Account creation failed');
          setErrorCode('CREATE_ERROR');
        }
        setIsLoading(false);
        return { success: false, error: data.error };
      }

      // Account created - use server-generated hash
      setUserHash(data.hash);
      setIsAuthenticated(true);
      setSessionKeys(data.hash, normalizedKey);

      setIsLoading(false);
      return {
        success: true,
        message: 'Account created successfully!',
        isNewAccount: true
      };

    } catch (err) {
      setError('Account creation failed. Please try again.');
      setErrorCode('CREATE_ERROR');
      setIsLoading(false);
      return { success: false, error: err.message };
    }
  }, []);

  /**
   * Store the session for Docs AND its Workdeck siblings (single origin,
   * shared sessionStorage). Mirrors the keys, so
   * navigating between the apps never requires re-login.
   */
  const setSessionKeys = useCallback((hash, key) => {
    sessionStorage.setItem('docs_hash', hash);
    sessionStorage.setItem('docs_key', key);
    sessionStorage.setItem('wd_hash', hash);
    sessionStorage.setItem('wd_key', key);
    sessionStorage.setItem('sheets_user_hash', hash);
    sessionStorage.setItem('sheets_user_key', key);
    sessionStorage.setItem('forms_user_hash', hash);
    sessionStorage.setItem('forms_user_key', key);
    sessionStorage.setItem('slides_user_hash', hash);
    sessionStorage.setItem('slides_user_key', key);
    sessionStorage.setItem('draw_user_hash', hash);
    sessionStorage.setItem('draw_user_key', key);
  }, []);

  /**
   * Logout - clear the shared session (all three apps)
   */
  const logout = useCallback(() => {
    setUserHash(null);
    setIsAuthenticated(false);
    ['docs_hash', 'docs_key', 'wd_hash', 'wd_key',
     'sheets_user_hash', 'sheets_user_key',
     'forms_user_hash', 'forms_user_key',
     'slides_user_hash', 'slides_user_key',
     'draw_user_hash', 'draw_user_key']
      .forEach(name => sessionStorage.removeItem(name));
  }, []);

  /**
   * Delete account - remove user data from server and clear session
   * @param {string} hash - User's hash to delete
   * @returns {Promise<Object>} - Deletion result { success, error }
   */
  const deleteAccount = useCallback(async (hash) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/docs?hash=${encodeURIComponent(hash)}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete account');
      }

      // Clear local session and storage
      setUserHash(null);
      setIsAuthenticated(false);
      ['docs_hash', 'docs_key', 'wd_hash', 'wd_key',
       'sheets_user_hash', 'sheets_user_key',
       'forms_user_hash', 'forms_user_key',
       'slides_user_hash', 'slides_user_key',
       'draw_user_hash', 'draw_user_key']
        .forEach(name => sessionStorage.removeItem(name));

      setIsLoading(false);
      return { success: true, message: 'Account deleted successfully' };

    } catch (err) {
      setError('Failed to delete account. Please try again.');
      setIsLoading(false);
      return { success: false, error: err.message };
    }
  }, []);

  /**
   * Verify the session hash with the server in the background. The session
   * is already trusted optimistically at first paint (see useState above);
   * this only corrects the record when the hash is stale or the account is
   * gone, so a revoked session lands on the login screen after load.
   */
  const checkSession = useCallback(async () => {
    // Fall back to legacy key so existing sessions survive the rename
    const savedHash = sessionStorage.getItem('docs_hash') || sessionStorage.getItem('docs_hash');
    if (!savedHash) return false;
    try {
      const response = await fetch(`/api/docs?hash=${encodeURIComponent(savedHash)}`);
      if (response.ok) {
        return true;
      }
    } catch (error) {
      // Network hiccup: keep the optimistic session rather than logging out
      console.error('Session check failed:', error);
      return true;
    }
    // Hash no longer valid server-side - clear the session
    sessionStorage.removeItem('docs_hash');
    sessionStorage.removeItem('docs_hash');
    sessionStorage.removeItem('docs_key');
    sessionStorage.removeItem('docs_key');
    setUserHash(null);
    setIsAuthenticated(false);
    return false;
  }, []);

  /**
   * Get the stored user key
   * @returns {string|null} - The user's key or null if not found
   */
  const getUserKey = useCallback(() => {
    return sessionStorage.getItem('docs_key') || sessionStorage.getItem('docs_key');
  }, []);

  return {
    userHash,
    isAuthenticated,
    isLoading,
    error,
    errorCode,
    login,
    createAccount,
    logout,
    deleteAccount,
    checkSession,
    getUserKey
  };
}
