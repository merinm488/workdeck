import { useState, useEffect } from 'react';
import { generateRandomKey } from '../lib/wordlist';
import { normalizeKey } from '../lib/cryptoUtils';

/**
 * Login Component
 *
 * This is the entry point for the application.
 * Users enter their key - if it doesn't exist, a new account is automatically created.
 */
export function Login({ onLogin, isLoading, error }) {
  const [keyInput, setKeyInput] = useState('');
  const [wasLoading, setWasLoading] = useState(false);

  // Clear key input after successful login/account creation
  useEffect(() => {
    if (wasLoading && !isLoading) {
      // Operation completed - clear the key for security
      // Only clear if it was successful (no error)
      if (!error) {
        setKeyInput('');
      }
    }
    setWasLoading(isLoading);
  }, [isLoading, error]);

  /**
   * Handle login form submission
   */
  const handleLogin = (e) => {
    e.preventDefault();
    if (keyInput.trim()) {
      // Normalize the key before sending to server
      onLogin(normalizeKey(keyInput.trim()));
    }
  };

  /**
   * Generate a random key
   */
  const handleGenerateKey = () => {
    const randomKey = generateRandomKey();
    setKeyInput(randomKey);
  };

  return (
    <div className="h-screen flex items-center justify-center p-4 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 overflow-auto">
      <div className="max-w-md w-full">
        {/* Logo/Title */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-400/10 mb-4 dark:bg-white/10">
            <svg
              className="w-8 h-8 text-blue-500 dark:text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 animate-slide-up">
          <form onSubmit={handleLogin} className="space-y-4" autoComplete="off">
            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 rounded-lg border bg-red-500/10 border-red-500/20">
                <p className="text-sm text-red-500">
                  {error}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="key" className="block text-sm font-medium mb-2">
                Enter your Key
              </label>
              <input
                id="key"
                type="text"
                name="login-key"
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value);
                }}
                placeholder="Enter your key to access the account"
                className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 [&::placeholder]:italic"
                disabled={isLoading}
                autoFocus
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !keyInput}
              className="bg-blue-600 text-white dark:bg-white dark:text-black px-4 py-2 rounded-lg font-medium w-full disabled:opacity-50 hover:bg-blue-700 dark:hover:bg-gray-200"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  or
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerateKey}
              disabled={isLoading}
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 px-4 py-2 rounded-lg font-medium disabled:opacity-50"
            >
              Generate Random Key
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
