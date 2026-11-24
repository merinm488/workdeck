// Holm Forms. Private form drafts and response-to-Sheets links are scoped to
// the verified member. A random public token exposes questions only; the
// corresponding submissions are readable solely by the owner, even to a
// visitor holding the share URL. No legacy account hash/key is accepted.
const FORMS = 'user_forms';
const SHARES = 'form_public_shares';
const SHEETS = 'sheet_records';
const BODIES = 'sheet_bodies';
const TAGS = 'workspace_tags';
const PREFS = 'workdeck_settings';
const ID = /^[a-zA-Z0-9_-]{8,128}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const idOK = value => typeof value === 'string' && ID.test(value);
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status) => json({ success: false, error }, status);
const stamp = () => new Date().toISOString();
const randomToken = () => {
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
};
const lookup = (ds, secret) => ds.find(SHARES, { token: secret }, { limit: 1 })[0] || null;
const bodyOf = (ds, sheetId) => ds.find(BODIES, { sheetId }, { limit: 1 })[0] || null;
const publicForm = form => ({ id: form.id, name: form.name, display: form.display,
  components: form.components, createdAt: form.createdAt, updatedAt: form.updatedAt });
const view = (ds, kv) => ({ forms: ds.find(FORMS, {}, { limit: 200, order: 'desc' }),
  sheets: ds.find(SHEETS, {}, { limit: 200, order: 'desc' }),
  tags: ds.find(TAGS, {}, { limit: 200, order: 'desc' }),
  settings: { theme: 'dark', ...(kv.get(PREFS) || {}) } });
const SKIP = new Set(['button', 'hidden', 'text', 'image', 'html', 'separator', 'spacer', 'documentPreview', 'iframe', 'table']);
function leaves(components) {
  const out = [];
  const walk = (list, depth) => {
    if (depth > 12) return;
    for (const item of list || []) {
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item.components)) walk(item.components, depth + 1);
      else out.push(item);
    }
  };
  walk(components, 0);
  return out;
}
function columnsOf(components) {
  return leaves(components).filter(c => c.type && c.key && !SKIP.has(c.type))
    .map(c => ({ key: c.key, label: c.label || c.key }));
}
function answerCell(value, options) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return { v: value.map(v => answerCell(v, options)?.v || '').filter(Boolean).join(', '), t: 1 };
  if (typeof value === 'boolean') return { v: value ? 'Yes' : 'No', t: 1 };
  if (typeof value === 'number' && Number.isFinite(value)) return { v: value, t: 2 };
  if (typeof value === 'object') return { v: JSON.stringify(value), t: 1 };
  const found = options?.find(opt => opt && (opt.value === value || opt.label === value));
  return { v: found ? found.label : String(value), t: 1 };
}
function answerOptions(form) {
  const entries = new Map();
  for (const c of leaves(form.components || [])) {
    const values = c.values || c.data?.values;
    if (c.key && Array.isArray(values)) entries.set(c.key, values);
  }
  return entries;
}
function writeCells(body, columns, responses, questionForm, existing = null) {
  const tab = body.sheets?.[body.sheetOrder?.[0]];
  if (!tab || !tab.cellData || !Array.isArray(columns)) return false;
  const options = answerOptions(questionForm);
  const seen = new Set(existing?.syncedResponseIds || []);
  const pending = (responses || []).filter(r => r?.id && !seen.has(r.id))
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));
  const rowNums = Object.keys(tab.cellData).map(Number).filter(Number.isFinite);
  let index = rowNums.length ? Math.max(...rowNums) + 1 : 0;
  if (existing && !pending.length && columns.length === (existing.sheetColumns || []).length) return false;
  if (existing && columns.length > (existing.sheetColumns || []).length) {
    const headers = tab.cellData['0'] || {};
    for (let i = (existing.sheetColumns || []).length; i < columns.length; i++)
      headers[String(i + 1)] = { v: columns[i].label, t: 1 };
    tab.cellData['0'] = headers;
  }
  if (!existing) {
    tab.cellData['0'] = Object.fromEntries(['Timestamp', ...columns.map(c => c.label)]
      .map((h, i) => [String(i), { v: h, t: 1 }]));
    index = 1;
  }
  for (const response of pending) {
    const cells = [{ v: response.submittedAt || '', t: 1 },
      ...columns.map(c => answerCell(response.data?.[c.key], options.get(c.key)))];
    const row = {};
    cells.forEach((cell, col) => { if (cell) row[String(col)] = cell; });
    tab.cellData[String(index++)] = row;
  }
  tab.rowCount = Math.max(tab.rowCount || 84, index + 25);
  tab.columnCount = Math.max(tab.columnCount || 60, columns.length + 4);
  return pending.map(r => r.id);
}
function responseWorkbook(sheetId, name) {
  const tab = `sheet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return { id: `wb_${sheetId}`, name, appVersion: '0.25.1', locale: 'enUS',
    styles: {}, sheetOrder: [tab], sheets: { [tab]: {
      id: tab, name: 'Sheet1', tabColor: '', hidden: 0,
      freeze: { xOffset: 0, yOffset: 0, startRow: -1, startColumn: -1, xSplit: 0, ySplit: 0 },
      rowCount: 84, columnCount: 60, zoomRatio: 1, scrollTop: 0, scrollLeft: 0,
      defaultColumnWidth: 73, defaultRowHeight: 19, mergeData: [], cellData: {},
      rowData: {}, columnData: {},
    } } };
}
function validateForm(form) {
  if (!form || typeof form !== 'object' || Array.isArray(form) ||
      typeof form.name !== 'string' || !form.name.trim() || form.name.trim().length > 200 ||
      !Array.isArray(form.components) || form.components.length > 200 ||
      form.display !== undefined && form.display !== 'form') return false;
  try {
    const raw = JSON.stringify(form.components);
    if (raw.length > 250_000) return false;
    // Untrusted HTML/js handlers never become executable in the public view.
    if (/<\s*script\b|\son[a-z]+\s*=|javascript\s*:/i.test(raw)) return false;
    return true;
  } catch (_) { return false; }
}
function syncLinked(tx, form, share) {
  const link = form.linkedSheet;
  if (!link?.sheetId) return null;
  const sheet = tx.findOne(SHEETS, link.sheetId);
  const record = sheet && bodyOf(tx, link.sheetId);
  if (!record?.data?.sheets) { delete form.linkedSheet; return null; }
  const columns = [...(link.sheetColumns || [])];
  for (const col of columnsOf(share.form.components || []))
    if (!columns.some(c => c.key === col.key)) columns.push(col);
  const workbook = record.data;
  const appended = writeCells(workbook, columns, share.responses || [], share.form, link);
  if (appended === false) return link;
  if (!Array.isArray(appended)) throw new Error('Cannot sync linked sheet');
  tx.update(BODIES, { id: record.id }, { $set: { data: workbook } });
  tx.update(SHEETS, { id: sheet.id }, { $set: { version: sheet.version + 1, updatedAt: stamp() } });
  link.syncedResponseIds = [...(link.syncedResponseIds || []), ...appended];
  link.sheetColumns = columns;
  return link;
}

export async function handleForms(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/forms') return fail('Not found.', 404);
  const globalDS = env.holm.app.ds;
  if (request.method === 'GET' && url.searchParams.has('shared')) {
    const secret = url.searchParams.get('shared');
    if (!TOKEN.test(secret || '')) return fail('Shared form not found', 404);
    const copy = lookup(globalDS, secret);
    return copy ? json({ success: true, form: publicForm(copy.form), sharedAt: copy.sharedAt }) :
      fail('Shared form not found', 404);
  }
  if (request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return fail('Invalid origin.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('JSON required.', 400);
    const raw = await request.text();
    if (raw.length > 40_000) return fail('Response too large.', 413);
    let input;
    try { input = JSON.parse(raw); } catch { return fail('Invalid JSON.', 400); }
    if (!input || input.action !== 'submitResponse' || !TOKEN.test(input.shareId || '') ||
        'hash' in input || 'key' in input || 'memberId' in input ||
        !input.data?.response || typeof input.data.response !== 'object' ||
        Array.isArray(input.data.response) || !input.data.response.data ||
        typeof input.data.response.data !== 'object' || Array.isArray(input.data.response.data) ||
        JSON.stringify(input.data.response.data).length > 30_000) return fail('Invalid response.', 400);
    if (!lookup(globalDS, input.shareId)) return fail('Shared form not found', 404);
    const budgetKey = `form-submissions:${input.shareId}:${Math.floor(Date.now() / 3600000)}`;
    if (env.holm.app.kv.increment(budgetKey) > 300) return fail('Form is receiving too many submissions. Try again later.', 429);
    const responseId = randomToken();
    if (!responseId) return fail('Secure submissions are unavailable.', 503);
    const result = globalDS.transaction(tx => {
      const copy = lookup(tx, input.shareId);
      if (!copy) return 'missing';
      const responses = copy.responses || [];
      if (responses.length >= 2000 || JSON.stringify(responses).length + raw.length > 1_500_000) return 'full';
      const response = { id: responseId,
        submittedAt: stamp(), data: input.data.response.data,
        meta: { userAgent: typeof input.data.response.meta?.userAgent === 'string'
          ? input.data.response.meta.userAgent.slice(0, 300) : '' } };
      responses.push(response);
      tx.update(SHARES, { id: copy.id }, { $set: { responses } });
      return 'ok';
    });
    return result === 'ok' ? json({ success: true, message: 'Response submitted' }, 201) :
      result === 'missing' ? fail('Shared form not found', 404) : fail('Form response limit reached.', 413);
  }
  if (!env.holm.auth.getMember()) return fail('Sign in to continue.', 401);
  const { ds, kv } = env.holm.app.member;
  if (request.method === 'GET') return json({ success: true, data: view(ds, kv) });
  if (request.method !== 'PUT') return fail('Method not allowed.', 405);
  if (request.headers.get('origin') !== url.origin) return fail('Invalid origin.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('JSON required.', 400);
  const raw = await request.text();
  if (raw.length > 300_000) return fail('Form too large.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail('Invalid JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.data ||
      typeof body.data !== 'object' || Array.isArray(body.data) ||
      'hash' in body || 'key' in body || 'memberId' in body) return fail('Invalid request.', 400);
  const { action, data } = body;
  if (action === 'updateSettings') {
    if (!data.settings || typeof data.settings !== 'object' ||
        Object.keys(data.settings).some(k => k !== 'theme') ||
        'theme' in data.settings && !['dark', 'light', 'system'].includes(data.settings.theme)) return fail('Invalid settings.', 400);
    kv.set(PREFS, { ...(kv.get(PREFS) || {}), ...data.settings });
    return json({ success: true, data: view(ds, kv) });
  }
  if (!idOK(data.formId)) return fail('Invalid form ID.', 400);
  const existing = ds.findOne(FORMS, data.formId);
  if (!existing) return fail('Form not found', 404);
  if (action === 'updateForm') {
    if (!validateForm(data.formData)) return fail('Invalid form.', 400);
    if (!Number.isSafeInteger(data.version) || data.version !== existing.version)
      return fail('Form changed in another tab. Reload before saving.', 409);
    const form = data.formData;
    const updated = ds.transaction(tx => {
      const prior = tx.findOne(FORMS, data.formId);
      if (!prior || prior.version !== data.version) return null;
      const patch = { name: form.name.trim(), display: form.display || 'form',
        components: form.components, updatedAt: stamp(), version: prior.version + 1 };
      tx.update(FORMS, { id: data.formId }, { $set: patch });
      return { ...prior, ...patch };
    });
    if (!updated) return fail('Form changed in another tab. Reload before saving.', 409);
    if (updated.sharedId) {
      const copy = lookup(globalDS, updated.sharedId);
      if (!copy) return fail('Could not update public copy. Private changes were saved.', 503);
      globalDS.update(SHARES, { id: copy.id }, { $set: { form: publicForm(updated), sharedAt: stamp() } });
    }
    return json({ success: true, data: view(ds, kv) });
  }
  if (action === 'deleteForm') {
    if (!Number.isSafeInteger(data.version) || data.version !== existing.version) return fail('Form changed in another tab.', 409);
    if (existing.sharedId) {
      const copy = lookup(globalDS, existing.sharedId);
      if (copy) globalDS.delete(SHARES, { id: copy.id });
    }
    const removed = ds.transaction(tx => {
      const form = tx.findOne(FORMS, data.formId);
      if (!form || form.version !== data.version) return false;
      tx.delete(FORMS, { id: data.formId });
      return true;
    });
    if (!removed) return fail('Form changed in another tab.', 409);
    const prefs = kv.get(PREFS) || {};
    const lastOpened = { ...(prefs.lastOpened || {}) };
    delete lastOpened[data.formId];
    kv.set(PREFS, { ...prefs, lastOpened });
    return json({ success: true, data: view(ds, kv) });
  }
  if (action === 'shareForm') {
    if (!Number.isSafeInteger(data.version) || data.version !== existing.version) return fail('Form changed in another tab.', 409);
    if (existing.sharedId) {
      const copy = lookup(globalDS, existing.sharedId);
      if (!copy) return fail('Shared copy unavailable.', 503);
      globalDS.update(SHARES, { id: copy.id }, { $set: { form: publicForm(existing), sharedAt: stamp() } });
      return json({ success: true, shareId: existing.sharedId,
        shareUrl: `${url.origin}/forms/shared.html?shared=${existing.sharedId}`,
        alreadyShared: true, data: view(ds, kv) });
    }
    const secret = randomToken();
    if (!secret) return fail('Secure sharing is unavailable.', 503);
    const publicId = globalDS.insert(SHARES, { token: secret, form: publicForm(existing), responses: [], sharedAt: stamp() });
    const stored = ds.transaction(tx => {
      const current = tx.findOne(FORMS, data.formId);
      if (!current || current.version !== data.version || current.sharedId) return false;
      tx.update(FORMS, { id: data.formId }, { $set: { sharedId: secret, version: current.version + 1 } });
      return true;
    });
    if (!stored) { globalDS.delete(SHARES, { id: publicId }); return fail('Form changed in another tab.', 409); }
    return json({ success: true, shareId: secret,
      shareUrl: `${url.origin}/forms/shared.html?shared=${secret}`,
      alreadyShared: false, data: view(ds, kv) });
  }
  if (action === 'getResponses') {
    if (!existing.sharedId) return json({ success: true, responses: [], form: null, linkedSheet: existing.linkedSheet || null });
    const share = lookup(globalDS, existing.sharedId);
    if (!share) return json({ success: true, responses: [], form: null, linkedSheet: existing.linkedSheet || null });
    if (existing.linkedSheet) {
      try {
        ds.transaction(tx => {
          const form = tx.findOne(FORMS, data.formId);
          if (!form?.linkedSheet?.sheetId) return;
          const before = JSON.stringify(form.linkedSheet);
          syncLinked(tx, form, share);
          if (JSON.stringify(form.linkedSheet) !== before)
            tx.update(FORMS, { id: form.id }, { $set: { linkedSheet: form.linkedSheet || null,
              version: form.version + 1, updatedAt: stamp() } });
        });
      } catch (_) { return fail('Could not sync linked responses. Try again.', 503); }
    }
    const refreshed = ds.findOne(FORMS, data.formId);
    return json({ success: true, responses: share.responses || [],
      form: publicForm(share.form), linkedSheet: refreshed.linkedSheet || null,
      data: view(ds, kv) });
  }
  if (action === 'deleteResponses') {
    if (existing.sharedId) {
      const share = lookup(globalDS, existing.sharedId);
      if (share) globalDS.update(SHARES, { id: share.id }, { $set: { responses: [] } });
    }
    return json({ success: true, message: 'Responses cleared' });
  }
  if (action === 'linkSheet') {
    if (!existing.sharedId) return fail('Share the form before linking it to a spreadsheet.', 400);
    const share = lookup(globalDS, existing.sharedId);
    if (!share) return fail('Shared form not found.', 404);
    const current = existing.linkedSheet?.sheetId && ds.findOne(SHEETS, existing.linkedSheet.sheetId);
    if (current) return json({ success: true, sheetId: current.id,
      sheetUrl: `${url.origin}/sheets/editor.html?id=${current.id}`, alreadyLinked: true, data: view(ds, kv) });
    const linked = ds.transaction(tx => {
      const form = tx.findOne(FORMS, data.formId);
      if (!form) return null;
      if (form.linkedSheet?.sheetId && tx.findOne(SHEETS, form.linkedSheet.sheetId))
        return { id: form.linkedSheet.sheetId, alreadyLinked: true };
      if (tx.count(SHEETS, {}) >= 200) return null;
      const name = `${form.name || 'Untitled Form'} (Responses)`;
      const updatedAt = stamp();
      const base = { name, formatVersion: 2, tagId: null, version: 1, createdAt: updatedAt, updatedAt };
      const sheetId = tx.insert(SHEETS, base);
      const workbook = responseWorkbook(sheetId, name);
      const columns = columnsOf(share.form.components || []);
      const ids = writeCells(workbook, columns, share.responses || [], share.form);
      if (!Array.isArray(ids)) throw new Error('Could not build response sheet');
      tx.insert(BODIES, { sheetId, data: workbook });
      tx.update(FORMS, { id: form.id }, { $set: { linkedSheet: {
        sheetId, sheetColumns: columns, syncedResponseIds: ids, linkedAt: updatedAt,
      }, version: form.version + 1, updatedAt } });
      return { id: sheetId, alreadyLinked: false };
    });
    if (!linked) return fail('Unable to link spreadsheet.', 409);
    return json({ success: true, sheetId: linked.id,
      sheetUrl: `${url.origin}/sheets/editor.html?id=${linked.id}`,
      alreadyLinked: linked.alreadyLinked, data: view(ds, kv) });
  }
  if (action === 'unlinkSheet') {
    ds.transaction(tx => {
      const form = tx.findOne(FORMS, data.formId);
      if (form?.linkedSheet) tx.update(FORMS, { id: data.formId }, { $set: {
        linkedSheet: null, version: form.version + 1, updatedAt: stamp(),
      } });
    });
    return json({ success: true, message: 'Form unlinked', data: view(ds, kv) });
  }
  return fail('Unknown action.', 400);
}
