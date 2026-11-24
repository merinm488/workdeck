import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../holm/files/uploads.js', import.meta.url), 'utf8');
const savedFile = { id: 'record_1_abcdef', name: 'photo.txt', size: 5 };

function uploader(fetch, onFileUploaded = () => {}) {
  const events = [], requests = [], errors = [];
  const file = { id: 'file-1', name: 'photo.txt', type: 'text/plain', size: 5, data: {} };
  const uppy = {
    getFile: id => id === file.id ? file : null,
    emit: (type, ...args) => events.push({ type, args }),
  };
  class BasePlugin {
    constructor(uppy, opts) { this.uppy = uppy; this.opts = opts; }
  }
  const Plugin = runInNewContext(source + '\nFileboxJsonUploader', {
    window: { Uppy: { BasePlugin }, matchMedia: () => ({ matches: false }) },
    Uppy: { BasePlugin },
    APP_CONFIG: { maxFileSize: 300 * 1024 },
    FileReader: class {
      readAsDataURL() { this.result = 'data:text/plain;base64,SGVsbG8='; this.onload(); }
    },
    crypto: { randomUUID: () => 'upload_0123456789abcdef' },
    fetch: async (url, opts) => {
      requests.push({ url, opts });
      return fetch(url, opts);
    },
    console: { error: (...args) => errors.push(args) },
    encodeURIComponent,
  });
  const plugin = new Plugin(uppy, {
    endpoint: '/api/filebox', activeTagId: () => null, currentFolderId: () => null, onFileUploaded,
  });
  return { plugin, file, events, requests, errors };
}

test('a saved upload stays successful even if rendering the new file throws', async () => {
  const ui = uploader(async () => ({ status: 201, ok: true,
    json: async () => ({ success: true, file: savedFile }),
  }), () => { throw new Error('UI refresh failed'); });
  await ui.plugin.uploadOne(ui.file.id);
  assert.equal(ui.events.filter(e => e.type === 'upload-success').length, 1);
  assert.equal(ui.events.filter(e => e.type === 'upload-error').length, 0);
  assert.equal(ui.errors.length, 1);
  assert.equal(JSON.parse(ui.requests[0].opts.body).data.uploadId, 'upload_0123456789abcdef');
});

test('a lost upload response is reconciled before showing a retry error', async () => {
  const ui = uploader(async (url, opts) => {
    if (opts?.method === 'PUT') throw new Error('Connection dropped after commit');
    assert.match(url, /\?uploadId=upload_0123456789abcdef$/);
    return { status: 200, ok: true, json: async () => ({ success: true, file: savedFile }) };
  });
  await ui.plugin.uploadOne(ui.file.id);
  assert.equal(ui.events.filter(e => e.type === 'upload-success').length, 1);
  assert.equal(ui.events.filter(e => e.type === 'upload-error').length, 0);
  assert.equal(ui.requests.length, 2);
});

test('an uncommitted failed upload remains retryable with the same upload ID', async () => {
  let attempts = 0;
  const ui = uploader(async (url, opts) => {
    if (opts?.method === 'PUT') {
      if (++attempts === 1) throw new Error('Offline');
      return { status: 201, ok: true, json: async () => ({ success: true, file: savedFile }) };
    }
    return { status: 404, ok: false, json: async () => ({ success: false }) };
  });
  await ui.plugin.uploadOne(ui.file.id);
  await ui.plugin.uploadOne(ui.file.id);
  assert.equal(ui.events.filter(e => e.type === 'upload-error').length, 1);
  assert.equal(ui.events.filter(e => e.type === 'upload-success').length, 1);
  assert.equal(JSON.parse(ui.requests[0].opts.body).data.uploadId,
    JSON.parse(ui.requests[2].opts.body).data.uploadId);
});
