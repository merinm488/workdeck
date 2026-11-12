import crypto from 'node:crypto';
import { generateHash, getUserDoc, saveOwnedSections, getBaseUrl } from './store.js';
import { newGrantId, grantAccountTag, readMcpGrant, writeMcpGrant, readMcpCode, writeMcpCode } from './mcp-grants.js';
import { sealMcpAccessToken, authenticateMcpBearer, sealMcpState, openMcpState } from './mcp-auth.js';

const PERMISSIONS = ['todo:read', 'todo:write', 'workspace:read', 'workspace:write'];
const GRANT_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const CODE_LIFETIME = 3 * 60 * 1000;
const CONSENT_LIFETIME = 10 * 60 * 1000;
const CLIENT_LIFETIME = 365 * 24 * 60 * 60 * 1000;
const CLIENT_NAME_LIMIT = 80;

function origin(req) {
  const configured = process.env.MCP_PUBLIC_ORIGIN;
  if (configured) {
    if (/^https:\/\/[^/?#]+$/.test(configured) ||
        (process.env.NODE_ENV === 'development' &&
         /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(configured))) {
      return configured;
    }
    throw new Error('MCP_PUBLIC_ORIGIN must be a valid HTTPS origin');
  }
  if (process.env.NODE_ENV === 'development') return getBaseUrl(req);
  throw new Error('MCP_PUBLIC_ORIGIN must be set to the deployment HTTPS origin');
}

function checkConfig(req) {
  const base = origin(req);
  if (process.env.NODE_ENV !== 'development' &&
      (!process.env.PEPPER_SECRET ||
        process.env.PEPPER_SECRET === 'dev-pepper-change-in-production-9F2a-5xK8')) {
    throw new Error('MCP requires a private, unchanged production PEPPER_SECRET');
  }
  if (!/^[a-f0-9]{64}$/i.test(process.env.MCP_AUTH_SECRET || '')) {
    throw new Error('MCP_AUTH_SECRET must be a private 32-byte hex value');
  }
  return base;
}

function bodyOf(req) {
  return typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body || {};
}

function error(res, status, code) {
  return res.status(status).json({ error: code });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function redirectWith(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

function client(clientId) {
  const entry = openMcpState('client', clientId);
  if (!entry || !Array.isArray(entry.redirectUris) || !entry.redirectUris.length ||
      typeof entry.name !== 'string') return null;
  return entry;
}

function validRedirect(uri) {
  try {
    const value = new URL(uri);
    return !value.username && !value.password && !value.hash &&
      (value.protocol === 'https:' ||
        (value.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname)));
  } catch { return false; }
}

function html(req, res, text, status = 200, redirectUri) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Browsers also enforce form-action on a POST's OAuth redirect. Permit only
  // this validated client's registered callback, plus Workdeck itself.
  const callbackOrigin = redirectUri && validRedirect(redirectUri)
    ? new URL(redirectUri).origin : null;
  const allowedForms = ["'self'", origin(req), callbackOrigin].filter(Boolean).join(' ');
  res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action ${allowedForms}; base-uri 'none'; frame-ancestors 'none'`);
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(status).send(text);
}

function consentPage({ app, callback, transaction, message = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect AI · Workdeck</title><style>
  body{font:16px system-ui;background:#111827;color:#f9fafb;min-height:100vh;display:grid;place-items:center;margin:0;padding:20px;box-sizing:border-box}
  main{max-width:460px;width:100%;background:#1f2937;border:1px solid #374151;border-radius:16px;padding:32px;box-sizing:border-box}
  h1{font-size:1.5rem;margin:0 0 16px}p{line-height:1.5;color:#d1d5db}strong{color:white}
  label{display:block;margin:20px 0 8px}input{box-sizing:border-box;width:100%;padding:12px;background:#111827;color:white;border:1px solid #6b7280;border-radius:8px}
  .buttons{display:flex;gap:10px;margin-top:24px}button{padding:12px 18px;border:0;border-radius:8px;cursor:pointer;background:#60a5fa;color:#111827;font-weight:700}
  button[name=decision][value=deny]{background:#374151;color:white}.error{color:#fca5a5}</style></head><body><main>
  <h1>Connect AI to Workdeck</h1><p><strong>${escapeHtml(app)}</strong> wants to read and edit your Workdeck apps: Todo tasks, documents, blog drafts, calendars, boards and cards, form questions, slides, drawings, spreadsheet cells, folders and small files. File uploads require the client to supply the bytes (not a device path) and are limited to 100 KB. Publishing, deletion and account settings are not available.</p>
  <p>After approval, the connection stays active for up to 30 days. You can revoke it in Workdeck settings.</p>
  <p>Client redirect: <strong>${escapeHtml(callback)}</strong></p>
  ${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ''}
  <form action="/api/mcp-oauth?route=authorize" method="post">
    <input type="hidden" name="transaction" value="${escapeHtml(transaction)}">
    <label for="key">Workdeck account key</label><input id="key" name="key" type="password" required autocomplete="off" maxlength="200">
    <p>Enter the key for the Workdeck account you want to connect. Your key is sent only to Workdeck, never to the AI client.</p>
    <div class="buttons"><button name="decision" value="approve">Allow Workdeck access</button><button name="decision" value="deny" formnovalidate>Cancel</button></div>
  </form></main></body></html>`;
}

async function register(req, res) {
  if (req.method !== 'POST') return error(res, 405, 'method_not_allowed');
  const body = bodyOf(req);
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 3 ||
      !uris.every(uri => typeof uri === 'string' && uri.length < 512 && validRedirect(uri)) ||
      new Set(uris).size !== uris.length ||
      (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none')) {
    return error(res, 400, 'invalid_client_metadata');
  }
  const name = typeof body.client_name === 'string' && body.client_name.trim().slice(0, CLIENT_NAME_LIMIT) || 'AI client';
  const expiresAt = Date.now() + CLIENT_LIFETIME;
  const clientId = sealMcpState('client', { name, redirectUris: uris, expiresAt });
  return res.status(201).json({ client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: uris, client_name: name, token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'], response_types: ['code'] });
}

async function authorize(req, res) {
  if (req.method === 'GET') {
    const q = req.query || {};
    const app = client(q.client_id);
    if (!app || q.response_type !== 'code' || !app.redirectUris.includes(q.redirect_uri) ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge || '') ||
        q.code_challenge_method !== 'S256' ||
        (q.resource && q.resource !== `${origin(req)}/api/mcp`) ||
        (q.state != null && (typeof q.state !== 'string' || q.state.length > 512)) ||
        (q.scope && q.scope !== PERMISSIONS.join(' '))) {
      return error(res, 400, 'invalid_authorization_request');
    }
    const nonce = crypto.randomBytes(32).toString('hex');
    const transaction = sealMcpState('consent', {
      clientId: q.client_id, redirectUri: q.redirect_uri, challenge: q.code_challenge,
      state: q.state, nonce, expiresAt: Date.now() + CONSENT_LIFETIME
    });
    res.setHeader('Set-Cookie', `wd_mcp_consent=${nonce}; Path=/api/mcp-oauth; HttpOnly; SameSite=Lax; Max-Age=600${process.env.NODE_ENV === 'development' ? '' : '; Secure'}`);
    return html(req, res, consentPage({ app: app.name, callback: new URL(q.redirect_uri).origin, transaction }), 200, q.redirect_uri);
  }
  if (req.method !== 'POST') return error(res, 405, 'method_not_allowed');
  const body = bodyOf(req);
  const tx = openMcpState('consent', body.transaction);
  const cookie = /(?:^|;\s*)wd_mcp_consent=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
  if (!tx || !cookie || cookie[1] !== tx.nonce ||
      !client(tx.clientId)?.redirectUris.includes(tx.redirectUri)) {
    return error(res, 400, 'authorization_expired');
  }
  if (body.decision === 'deny') {
    res.setHeader('Set-Cookie', 'wd_mcp_consent=; Path=/api/mcp-oauth; HttpOnly; SameSite=Lax; Max-Age=0');
    return res.redirect(302, redirectWith(tx.redirectUri, { error: 'access_denied', state: tx.state }));
  }
  if (body.decision !== 'approve' || typeof body.key !== 'string' ||
      !body.key.trim() || body.key.length > 200) return error(res, 400, 'invalid_request');

  const accountHash = generateHash(body.key.trim());
  const account = await getUserDoc(accountHash);
  if (!account) {
    return html(req, res, consentPage({ app: client(tx.clientId).name,
      callback: new URL(tx.redirectUri).origin, transaction: body.transaction,
      message: 'Account not found. Check your Workdeck key.' }), 401, tx.redirectUri);
  }
  const accountId = account.settings.mcpAccountId || crypto.randomUUID();
  res.setHeader('Set-Cookie', 'wd_mcp_consent=; Path=/api/mcp-oauth; HttpOnly; SameSite=Lax; Max-Age=0');
  const grantId = newGrantId();
  const expiresAt = Date.now() + GRANT_LIFETIME;
  const grant = { accountId, accountTag: grantAccountTag(accountHash), status: 'active', permissions: PERMISSIONS,
    clientName: client(tx.clientId).name, createdAt: new Date().toISOString(), expiresAt };
  if (!(await writeMcpGrant(grantId, grant))) return error(res, 503, 'storage_unavailable');
  if (!(await saveOwnedSections(accountHash, { settings: { mcpAccountId: accountId, mcpGrantId: grantId } }))) {
    await writeMcpGrant(grantId, { ...grant, status: 'revoked' });
    return error(res, 503, 'storage_unavailable');
  }
  const code = crypto.randomBytes(32).toString('hex');
  if (!(await writeMcpCode(code, { accountHash, grantId, clientId: tx.clientId,
    redirectUri: tx.redirectUri, challenge: tx.challenge, status: 'issued',
    expiresAt: Date.now() + CODE_LIFETIME }))) {
    await writeMcpGrant(grantId, { ...grant, status: 'revoked' });
    return error(res, 503, 'storage_unavailable');
  }
  return res.redirect(302, redirectWith(tx.redirectUri, { code, state: tx.state }));
}

async function token(req, res) {
  if (req.method !== 'POST') return error(res, 405, 'method_not_allowed');
  const body = bodyOf(req);
  if (body.grant_type !== 'authorization_code' || !/^[a-f0-9]{64}$/.test(body.code || '') ||
      (body.resource && body.resource !== `${origin(req)}/api/mcp`) ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier || '')) {
    return error(res, 400, 'invalid_grant');
  }
  const code = await readMcpCode(body.code);
  if (!code || code.status !== 'issued' || code.expiresAt <= Date.now() ||
      code.clientId !== body.client_id || code.redirectUri !== body.redirect_uri ||
      !client(body.client_id)?.redirectUris.includes(body.redirect_uri)) {
    return error(res, 400, 'invalid_grant');
  }
  const expected = crypto.createHash('sha256').update(body.code_verifier).digest('base64url');
  if (expected !== code.challenge) return error(res, 400, 'invalid_grant');
  const [account, grant] = await Promise.all([getUserDoc(code.accountHash), readMcpGrant(code.grantId)]);
  if (!account || !grant || grant.status !== 'active' ||
      grant.accountId !== account.settings?.mcpAccountId ||
      grant.accountTag !== grantAccountTag(code.accountHash) ||
      code.grantId !== account.settings?.mcpGrantId || grant.expiresAt <= Date.now()) {
    return error(res, 400, 'invalid_grant');
  }
  // TextDB does not have compare-and-swap. PKCE protects the code, while
  // every redemption (including a concurrent duplicate) maps to the SAME
  // existing grant, whose revocation is checked on every MCP request.
  if (!(await writeMcpCode(body.code, { ...code, status: 'used' }))) {
    return error(res, 503, 'storage_unavailable');
  }
  const expiresAt = Math.min(grant.expiresAt, Date.now() + GRANT_LIFETIME);
  return res.status(200).json({ access_token: sealMcpAccessToken({
    accountHash: code.accountHash, grantId: code.grantId, expiresAt
  }), token_type: 'Bearer', expires_in: Math.floor((expiresAt - Date.now()) / 1000),
  scope: grant.permissions.join(' ') });
}

async function revoke(req, res) {
  if (req.method !== 'POST') return error(res, 405, 'method_not_allowed');
  const access = await authenticateMcpBearer(bodyOf(req).token && `Bearer ${bodyOf(req).token}`);
  if (access) {
    const grant = await readMcpGrant(access.grantId);
    if (!(await writeMcpGrant(access.grantId, { ...grant, status: 'revoked' }))) {
      return error(res, 503, 'storage_unavailable');
    }
  }
  return res.status(200).end();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  try {
    if (Number(req.headers['content-length'] || 0) > 16384) {
      return error(res, 413, 'request_too_large');
    }
    const base = checkConfig(req);
    const route = req.query.route;
    if (route === 'resource' && req.method === 'GET') {
      return res.status(200).json({ resource: `${base}/api/mcp`, authorization_servers: [base],
        bearer_methods_supported: ['header'], scopes_supported: PERMISSIONS });
    }
    if (route === 'server' && req.method === 'GET') {
      return res.status(200).json({ issuer: base,
        authorization_endpoint: `${base}/api/mcp-oauth?route=authorize`,
        token_endpoint: `${base}/api/mcp-oauth?route=token`,
        registration_endpoint: `${base}/api/mcp-oauth?route=register`,
        revocation_endpoint: `${base}/api/mcp-oauth?route=revoke`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: false, scopes_supported: PERMISSIONS });
    }
    if (route === 'register') return await register(req, res);
    if (route === 'authorize') return await authorize(req, res);
    if (route === 'token') return await token(req, res);
    if (route === 'revoke') return await revoke(req, res);
    return error(res, 404, 'not_found');
  } catch (err) {
    console.error('[MCP OAuth] Request failed:', err);
    return error(res, 503, 'temporarily_unavailable');
  }
}
