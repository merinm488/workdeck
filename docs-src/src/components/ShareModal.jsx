import { useState, useRef, useEffect } from 'react';

/**
 * ShareModal Component
 *
 * Modal for sharing docs:
 * - Displays shareable URL
 * - Copy to clipboard functionality
 * - Shows "Already shared" message if applicable
 */
export function ShareModal({ doc, shareUrl, alreadyShared = false, onClose }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);

  // Reset copied state when shareUrl changes
  useEffect(() => {
    setCopied(false);
  }, [shareUrl]);

  const handleCopy = async () => {
    if (shareUrl && inputRef.current) {
      try {
        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareUrl);
          setCopied(true);

          // Reset copied state after 2 seconds
          setTimeout(() => {
            setCopied(false);
          }, 2000);

          // Also select the text for visual feedback
          inputRef.current.select();
          return;
        }

        // Fallback for older browsers or non-secure contexts (HTTP on mobile)
        inputRef.current.select();
        inputRef.current.setSelectionRange(0, 99999); // For mobile devices

        try {
          // Try the older execCommand method
          const successful = document.execCommand('copy');
          if (successful) {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 2000);
          } else {
            // If execCommand fails, just select the text
            console.warn('execCommand failed, text selected for manual copy');
          }
        } catch (execErr) {
          console.error('Fallback copy also failed:', execErr);
          // Last resort: just select the text
          inputRef.current.select();
        }
      } catch (err) {
        console.error('Failed to copy:', err);

        // Fallback: select the text so user can manually copy
        inputRef.current.select();
        inputRef.current.setSelectionRange(0, 99999);
      }
    }
  };

  const handleKeyDown = (e) => {
    // Close on Escape
    if (e.key === 'Escape') {
      onClose();
    }
    // Copy on Ctrl/Cmd + C
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      handleCopy();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-white dark:bg-gray-800 w-full max-w-md md:max-w-lg flex flex-col rounded-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-400/10 dark:bg-white/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-500 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Share Doc
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Doc being shared */}
          <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              Sharing: <span className="font-medium text-gray-900 dark:text-gray-100">{doc?.title || 'Untitled'}</span>
            </p>
          </div>

          {/* Share URL Input */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Shareable Link
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={shareUrl || ''}
                readOnly
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 select-all"
                onClick={(e) => {
                  e.target.select();
                  e.target.setSelectionRange(0, 99999);
                }}
                onTouchEnd={(e) => {
                  e.target.select();
                  e.target.setSelectionRange(0, 99999);
                }}
              />
              <button
                onClick={handleCopy}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  handleCopy();
                }}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 select-none ${
                  copied
                    ? 'bg-green-500 text-white'
                    : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-white dark:text-black dark:hover:bg-gray-200'
                }`}
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
