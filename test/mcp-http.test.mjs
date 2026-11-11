import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

process.env.NODE_ENV = 'development';
process.env.MCP_AUTH_SECRET = crypto.randomBytes(32).toString('hex');

const { default: workdeck } = await import('../api/workdeck.js');
const { generateHash, createUserDoc, deleteUserDoc, getUserDoc } = await import('../api/_lib/store.js');
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

test('OAuth code + PKCE binds MCP Todo writes to the authorized account', async () => {
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
    const text = await consent.text();
    assert.match(text, /Allow Todo access/);
    const transaction = /name="transaction" value="([^"]+)"/.exec(text)?.[1];
    assert.ok(transaction);
    const consentCookie = consent.headers.get('set-cookie').split(';')[0];
    const wrongKey = await fetch(metadata.authorization_endpoint, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: consentCookie },
      body: new URLSearchParams({ transaction, key: `wrong-${key}`, decision: 'approve' })
    });
    assert.equal(wrongKey.status, 401);
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
    assert.equal(listed.body.result.tools.length, 5);
    const created = await rpc(accessToken, 'tools/call', {
      name: 'todo_create_list', arguments: { name: 'Agent errands' }
    });
    const listId = JSON.parse(created.body.result.content[0].text).id;
    assert.ok(listId);
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
    const connectionUrl = `${base}/api/mcp-connections?hash=${hash}`;
    assert.equal((await (await fetch(connectionUrl)).json()).connection.clientName, 'Test client');
    const revoked = await fetch(`${base}/api/mcp-connections`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash })
    });
    assert.equal(revoked.status, 200);
    assert.equal((await rpc(accessToken, 'tools/list')).status, 401);
  } finally {
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
