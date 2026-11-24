import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const css = readFileSync(new URL('../holm/auth/app-sidebar.css', import.meta.url), 'utf8');
const script = readFileSync(new URL('../holm/auth/app-sidebar.js', import.meta.url), 'utf8');

test('app home list Updated column reveals the timestamp hidden in card view', () => {
  assert.match(css, /\.wd-app-row-tag, \.wd-app-row-date, \.wd-app-list-more \{ display:none; \}/);
  assert.match(css, /body\.wd-app-side-available \.wd-app-items\.as-list \.wd-app-row-date \{[^}]*display:block;/);
  assert.match(script, /record\?\.updatedAt \|\| record\?\.createdAt/);
  assert.match(script, /date\.textContent = formatUpdatedAt\(stamp\)/);
  assert.match(script, /date\.dateTime = parsed\.toISOString\(\)/);
  assert.match(script, /setInterval\(\(\) => \{[\s\S]*?formatUpdatedAt\(date\.getAttribute\('datetime'\)\)/);
});

test('app home list shows relative minutes, hours, days, months and years', () => {
  const start = script.indexOf('  function formatUpdatedAt(');
  const end = script.indexOf('  async function request(', start);
  assert.ok(start > 0 && end > start);
  const now = Date.parse('2026-11-24T12:00:00.000Z');
  const format = runInNewContext(script.slice(start, end) + '\nformatUpdatedAt', {
    Date: class extends Date { static now() { return now; } },
  });
  const ago = minutes => new Date(now - minutes * 60_000).toISOString();
  for (const [minutes, label] of [
    [0, 'Just now'], [1, '1 min ago'], [59, '59 min ago'],
    [60, '1 hour ago'], [120, '2 hours ago'],
    [1440, '1 day ago'], [4 * 1440, '4 days ago'],
    [30 * 1440, '1 month ago'], [90 * 1440, '3 months ago'],
    [365 * 1440, '1 year ago'], [2 * 365 * 1440, '2 years ago'],
  ]) assert.equal(format(ago(minutes)), label);
  assert.equal(format('not-a-date'), '—');
  assert.equal(format(null), '—');
  assert.equal(format(new Date(now + 60_000).toISOString()), 'Just now');
});
