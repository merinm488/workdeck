import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

process.env.NODE_ENV = 'development';
process.env.MCP_AUTH_SECRET = crypto.randomBytes(32).toString('hex');

const { default: workdeck } = await import('../api/workdeck.js');
const { generateHash, createUserDoc, deleteUserDoc, getUserDoc, deleteRawDoc, deleteSheetBody } = await import('../api/_lib/store.js');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Mirror vercel.json's rewrites into the single Workdeck serverless function.
function viaWorkdeck(route, oauthRoute) {
  return (req, res) => {
    req.query.__wd_mcp_route = route;
    if (oauthRoute) req.query.route = oauthRoute;
    return workdeck(req, res);
  };
}
app.all('/api/mcp', viaWorkdeck('http'));
app.all('/api/mcp-oauth', viaWorkdeck('oauth'));
app.all('/api/mcp-connections', viaWorkdeck('connections'));
app.get('/.well-known/oauth-protected-resource/api/mcp', viaWorkdeck('oauth', 'resource'));
app.get('/.well-known/oauth-authorization-server', viaWorkdeck('oauth', 'server'));
const server = await new Promise(resolve => {
  const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
});
const base = `http://127.0.0.1:${server.address().port}`;

async function rpc(token, method, params = {}, id = 1) {
  const response = await fetch(`${base}/api/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
  return { status: response.status, body: await response.json() };
}

test('OAuth code + PKCE binds MCP writes to the authorized account', async () => {
  const key = `mcp-test-${crypto.randomUUID()}`;
  const hash = generateHash(key);
  const other = generateHash(`mcp-other-${crypto.randomUUID()}`);
  try {
    assert.equal((await createUserDoc(hash)).ok, true);
    assert.equal((await createUserDoc(other)).ok, true);
    const probe = await fetch(`${base}/api/mcp`, { method: 'POST' });
    assert.equal(probe.status, 401);
    assert.equal((await fetch(`${base}/api/mcp`)).status, 401);
    assert.match(probe.headers.get('www-authenticate'), /oauth-protected-resource/);
    const resource = await (await fetch(`${base}/.well-known/oauth-protected-resource/api/mcp`)).json();
    assert.equal(resource.resource, `${base}/api/mcp`);
    const metadata = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.equal(metadata.issuer, base);
    const callback = 'http://127.0.0.1:9876/callback';
    const registered = await fetch(metadata.registration_endpoint, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Test client', redirect_uris: [callback], token_endpoint_auth_method: 'none' }) });
    assert.equal(registered.status, 201);
    const { client_id: clientId } = await registered.json();
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const auth = new URL(metadata.authorization_endpoint);
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: clientId,
      redirect_uri: callback, code_challenge: challenge, code_challenge_method: 'S256', state: 'abc' })) {
      auth.searchParams.set(k, v);
    }
    const consent = await fetch(auth);
    assert.equal(consent.status, 200);
    const policy = consent.headers.get('content-security-policy');
    assert.match(policy, /form-action 'self'/);
    assert.ok(policy.includes(base));
    assert.ok(policy.includes(new URL(callback).origin));
    const text = await consent.text();
    assert.match(text, /Allow Workdeck access/);
    assert.match(text, /File uploads require the client to supply the bytes/);
    const transaction = /name="transaction" value="([^"]+)"/.exec(text)?.[1];
    assert.ok(transaction);
    const consentCookie = consent.headers.get('set-cookie').split(';')[0];
    const wrongKey = await fetch(metadata.authorization_endpoint, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: consentCookie },
      body: new URLSearchParams({ transaction, key: `wrong-${key}`, decision: 'approve' })
    });
    assert.equal(wrongKey.status, 401);
    assert.ok(wrongKey.headers.get('content-security-policy').includes(new URL(callback).origin));
    const approve = await fetch(metadata.authorization_endpoint, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: consentCookie },
      body: new URLSearchParams({ transaction, key, decision: 'approve' })
    });
    assert.equal(approve.status, 302);
    const authorized = new URL(approve.headers.get('location'));
    assert.equal(authorized.searchParams.get('state'), 'abc');
    const code = authorized.searchParams.get('code');
    assert.ok(code);
    const exchange = async codeVerifier => fetch(metadata.token_endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId,
        redirect_uri: callback, code_verifier: codeVerifier })
    });
    assert.equal((await exchange('x'.repeat(43))).status, 400);
    const tokens = await exchange(verifier);
    assert.equal(tokens.status, 200);
    const { access_token: accessToken } = await tokens.json();
    assert.equal((await exchange(verifier)).status, 400);
    const init = await rpc(accessToken, 'initialize', { protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.status, 200);
    const listed = await rpc(accessToken, 'tools/list');
    assert.equal(listed.body.result.tools.length, 21);
    const names = listed.body.result.tools.map(tool => tool.name);
    assert.ok(names.includes('workspace_create'));
    const created = await rpc(accessToken, 'tools/call', {
      name: 'todo_create_list', arguments: { name: 'Agent errands' }
    });
    const listId = JSON.parse(created.body.result.content[0].text).id;
    assert.ok(listId);
    const renamed = await rpc(accessToken, 'tools/call', {
      name: 'todo_rename_list', arguments: { listId, name: 'Shopping' }
    });
    assert.equal(JSON.parse(renamed.body.result.content[0].text).name, 'Shopping');
    const added = await rpc(accessToken, 'tools/call', {
      name: 'todo_add_task', arguments: { listId, title: 'Buy milk' }
    });
    const taskId = JSON.parse(added.body.result.content[0].text).task.id;
    const updated = await rpc(accessToken, 'tools/call', {
      name: 'todo_update_task', arguments: { listId, taskId, completed: true }
    });
    assert.equal(JSON.parse(updated.body.result.content[0].text).task.completed, true);
    assert.equal((await getUserDoc(hash)).todo[0].items[0].completed, true);
    assert.equal((await getUserDoc(other)).todo.length, 0);
    const createdDoc = await rpc(accessToken, 'tools/call', { name: 'workspace_create',
      arguments: { app: 'docs', name: 'Private notes', content: 'Hello' } });
    assert.equal(createdDoc.body.result.isError, undefined);
    const docId = JSON.parse(createdDoc.body.result.content[0].text).id;
    const docUpdate = await rpc(accessToken, 'tools/call', { name: 'workspace_update',
      arguments: { app: 'docs', recordId: docId, content: 'Updated' } });
    assert.equal(docUpdate.body.result.isError, undefined);
    assert.equal((await getUserDoc(hash)).docs.find(d => d.id === docId).content, 'Updated');
    const records = await rpc(accessToken, 'tools/call', { name: 'workspace_list', arguments: { app: 'docs' } });
    assert.equal(JSON.parse(records.body.result.content[0].text).total, 1);
    const blocked = await rpc(accessToken, 'tools/call', { name: 'workspace_create', arguments: { app: 'files', name: 'No' } });
    assert.equal(blocked.body.result.isError, true);
    assert.equal((await getUserDoc(other)).docs.length, 0);
    for (const appName of ['posts', 'calendars', 'kanban', 'forms', 'slides', 'draws']) {
      const result = await rpc(accessToken, 'tools/call', { name: 'workspace_create',
        arguments: { app: appName, name: `MCP ${appName}` } });
      assert.equal(result.body.result.isError, undefined, appName);
      assert.equal((await getUserDoc(hash))[appName].length, 1, appName);
      assert.equal((await getUserDoc(other))[appName].length, 0, appName);
    }
    const calendarId = (await getUserDoc(hash)).calendars[0].id;
    const event = await rpc(accessToken, 'tools/call', { name: 'workspace_create',
      arguments: { app: 'events', calId: calendarId, name: 'Meeting',
        start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z' } });
    assert.equal(event.body.result.isError, undefined);
    const postId = (await getUserDoc(hash)).posts[0].id;
    const post = await rpc(accessToken, 'tools/call', { name: 'workspace_update',
      arguments: { app: 'posts', recordId: postId, content: '<script>alert(1)</script><p>Safe</p>' } });
    assert.equal(post.body.result.isError, undefined);
    assert.equal((await getUserDoc(hash)).posts[0].html, '<p>Safe</p>');
    const invalid = await rpc(accessToken, 'tools/call', { name: 'workspace_read',
      arguments: { app: 'settings', recordId: docId } });
    assert.equal(invalid.body.result.isError, true);
    const boardId = (await getUserDoc(hash)).kanban[0].id;
    const column = await rpc(accessToken, 'tools/call', { name: 'kanban_add_column',
      arguments: { boardId, label: 'Doing' } });
    assert.equal(column.body.result.isError, undefined);
    const columnId = JSON.parse(column.body.result.content[0].text).id;
    const card = await rpc(accessToken, 'tools/call', { name: 'kanban_upsert_card',
      arguments: { boardId, column: columnId, label: 'Write report', description: 'Draft' } });
    assert.equal(card.body.result.isError, undefined);
    assert.equal((await getUserDoc(hash)).kanban[0].cards[0].label, 'Write report');
    const formId = (await getUserDoc(hash)).forms[0].id;
    const question = await rpc(accessToken, 'tools/call', { name: 'form_upsert_question',
      arguments: { formId, type: 'textfield', label: 'Your name', required: true } });
    assert.equal(question.body.result.isError, undefined);
    assert.equal((await getUserDoc(hash)).forms[0].components[0].label, 'Your name');
    const deckId = (await getUserDoc(hash)).slides[0].id;
    const slideId = (await getUserDoc(hash)).slides[0].slides[0].id;
    const slideText = await rpc(accessToken, 'tools/call', { name: 'canvas_add_object',
      arguments: { app: 'slides', recordId: deckId, slideId, left: 40, top: 30, text: 'Hello' } });
    assert.equal(slideText.body.result.isError, undefined);
    assert.equal((await getUserDoc(hash)).slides[0].slides[0].objects[0].text, 'Hello');
    const slideEdit = await rpc(accessToken, 'tools/call', { name: 'canvas_update_object',
      arguments: { app: 'slides', recordId: deckId, slideId, objectIndex: 0, text: 'Updated slide' } });
    assert.equal(slideEdit.body.result.isError, undefined);
    assert.equal((await getUserDoc(hash)).slides[0].slides[0].objects[0].text, 'Updated slide');
    const drawingId = (await getUserDoc(hash)).draws[0].id;
    const drawText = await rpc(accessToken, 'tools/call', { name: 'canvas_add_object',
      arguments: { app: 'draws', recordId: drawingId, left: 10, top: 20, text: 'Drawn' } });
    assert.equal(drawText.body.result.isError, undefined);
    assert.equal((await getUserDoc(hash)).draws[0].objects[0].text, 'Drawn');
    const sheet = await rpc(accessToken, 'tools/call', { name: 'sheet_create', arguments: { name: 'Expenses' } });
    assert.equal(sheet.body.result.isError, undefined);
    const sheetId = JSON.parse(sheet.body.result.content[0].text).id;
    const writeCell = await rpc(accessToken, 'tools/call', { name: 'sheet_cells',
      arguments: { sheetId, cells: [{ row: 0, column: 0, value: 'Amount' }, { row: 1, column: 0, value: 42 }] } });
    assert.equal(writeCell.body.result.isError, undefined);
    assert.equal(JSON.parse(writeCell.body.result.content[0].text).cells[1].value, 42);
    const folder = await rpc(accessToken, 'tools/call', { name: 'folder_create', arguments: { name: 'Uploads' } });
    assert.equal(folder.body.result.isError, undefined);
    const folderId = JSON.parse(folder.body.result.content[0].text).id;
    const uploaded = await rpc(accessToken, 'tools/call', { name: 'file_upload',
      arguments: { name: 'note.txt', mime: 'text/plain', folderId, base64: Buffer.from('hello').toString('base64') } });
    assert.equal(uploaded.body.result.isError, undefined);
    const fileId = JSON.parse(uploaded.body.result.content[0].text).id;
    const fileRead = await rpc(accessToken, 'tools/call', { name: 'file_read', arguments: { fileId } });
    assert.equal(JSON.parse(fileRead.body.result.content[0].text).base64, Buffer.from('hello').toString('base64'));
    const fileMeta = await rpc(accessToken, 'tools/call', { name: 'workspace_read',
      arguments: { app: 'files', recordId: fileId } });
    assert.equal(JSON.parse(fileMeta.body.result.content[0].text).storageKey, undefined);
    assert.equal((await getUserDoc(other)).files.length, 0);
    const wrongBoard = await rpc(accessToken, 'tools/call', { name: 'kanban_upsert_card',
      arguments: { boardId: 'missing', label: 'No access' } });
    assert.equal(wrongBoard.body.result.isError, true);
    const badUpload = await rpc(accessToken, 'tools/call', { name: 'file_upload',
      arguments: { name: 'bad.txt', mime: 'text/plain', base64: 'not-base64!' } });
    assert.equal(badUpload.body.result.isError, true);
    assert.equal((await getUserDoc(hash)).files.length, 1);
    const connectionUrl = `${base}/api/mcp-connections?hash=${hash}`;
    assert.equal((await (await fetch(connectionUrl)).json()).connection.clientName, 'Test client');
    const revoked = await fetch(`${base}/api/mcp-connections`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash })
    });
    assert.equal(revoked.status, 200);
    assert.equal((await rpc(accessToken, 'tools/list')).status, 401);
  } finally {
    const stored = await getUserDoc(hash);
    for (const file of stored?.files || []) await deleteRawDoc(file.storageKey);
    for (const sheet of stored?.sheets || []) await deleteSheetBody(sheet.id);
    await deleteUserDoc(hash);
    await deleteUserDoc(other);
  }
});

test('development can advertise a public HTTPS tunnel for remote MCP clients', async () => {
  const previous = process.env.MCP_PUBLIC_ORIGIN;
  process.env.MCP_PUBLIC_ORIGIN = 'https://workdeck-test-tunnel.example';
  try {
    const metadata = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.equal(metadata.issuer, process.env.MCP_PUBLIC_ORIGIN);
    const unauthorized = await fetch(`${base}/api/mcp`, { method: 'POST' });
    assert.match(unauthorized.headers.get('www-authenticate'),
      /https:\/\/workdeck-test-tunnel\.example\/\.well-known\/oauth-protected-resource/);
  } finally {
    if (previous === undefined) delete process.env.MCP_PUBLIC_ORIGIN;
    else process.env.MCP_PUBLIC_ORIGIN = previous;
  }
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
