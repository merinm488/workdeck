// The access-key form is replaced by Holm's native sign-in. The actual Docs
// editor, document list, shared view and styles are unchanged.
export function Login({ onLogin, isLoading, error }) {
  return <div className="h-screen flex items-center justify-center p-4 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
    <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 text-center">
      <h1 className="text-xl font-semibold mb-4">Docs</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{error || (isLoading ? 'Checking your sign-in…' : 'Sign in to open your Workdeck documents.')}</p>
      {!isLoading && <button onClick={onLogin} className="bg-blue-600 text-white dark:bg-white dark:text-black px-4 py-2 rounded-lg font-medium">Sign in with Holm</button>}
    </div>
  </div>;
}
