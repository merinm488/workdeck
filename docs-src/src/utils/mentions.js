/**
 * Textarea helpers for @mention autocomplete.
 *
 * The MDEditor text area is a plain <textarea>, so caret pixel coordinates
 * come from the classic "mirror div" measurement: replicate the textarea's
 * typography in a hidden div, cut the text at the caret, and read where the
 * remaining text starts — that's the caret position.
 */

/** Viewport-coordinate box of the caret inside a textarea. */
export function caretRect(textarea) {
  const cs = window.getComputedStyle(textarea);
  const div = document.createElement('div');
  const style = div.style;
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.font = cs.font;
  style.letterSpacing = cs.letterSpacing;
  style.tabSize = cs.tabSize;
  style.textIndent = cs.textIndent;
  style.padding = cs.padding;
  style.border = cs.border;
  style.boxSizing = cs.boxSizing;
  style.width = textarea.clientWidth + 'px';
  style.lineHeight = cs.lineHeight;

  div.textContent = textarea.value.slice(0, textarea.selectionStart);
  const sentinel = document.createElement('span');
  // The rest of the text starts exactly at the caret.
  sentinel.textContent = textarea.value.slice(textarea.selectionStart) || '.';
  div.appendChild(sentinel);
  document.body.appendChild(div);

  const box = textarea.getBoundingClientRect();
  const fontSize = parseFloat(cs.fontSize) || 14;
  const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.5;
  const left = box.left + (sentinel.offsetLeft - textarea.scrollLeft);
  const top = box.top + (sentinel.offsetTop - textarea.scrollTop);
  document.body.removeChild(div);

  return { left, right: left, top: top - fontSize, bottom: top + lineHeight * 0.4 };
}

/** The markdown form of a mention at [from, to) with the given text. */
export function insertMentionText(value, range, markdown) {
  return value.slice(0, range.from) + markdown + value.slice(range.to);
}

/** Escape a string for use in generated HTML. */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}