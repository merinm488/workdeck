import crypto from 'node:crypto';
import { getUserDoc } from './store.js';
import { readMcpGrant, grantAccountTag } from './mcp-grants.js';

const AAD = Buffer.from('workdeck-mcp-access-v1');

function secret() {
  const value = process.env.MCP_AUTH_SECRET;
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('MCP_AUTH_SECRET must be a 32-byte hex value');
  }
  return Buffer.from(value, 'hex');
}

/** Called only by the future, server-side OAuth token endpoint. */
export function sealMcpAccessToken({ accountHash, grantId, expiresAt }) {
  if (!/^[0-9a-f]{64}$/.test(accountHash) ||
      !/^[0-9a-f]{32}$/.test(grantId) ||
      !Number.isSafeInteger(expiresAt)) {
    throw new Error('Invalid MCP token fields');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret(), iv);
  cipher.setAAD(AAD);

  const plaintext = JSON.stringify({ accountHash, grantId, expiresAt });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  return [
    'wdm1',
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url')
  ].join('.');
}

function openMcpAccessToken(token) {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null;

    const [version, ivText, bodyText, tagText, extra] = token.split('.');
    if (version !== 'wdm1' || extra !== undefined) return null;

    const iv = Buffer.from(ivText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;

    const decipher = crypto.createDecipheriv('aes-256-gcm', secret(), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(bodyText, 'base64url')),
      decipher.final()
    ]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    return null;
  }
}

/** Returns an internal account binding, never a tool result. */
export async function authenticateMcpBearer(header) {
  const match = typeof header === 'string' &&
    /^Bearer (wdm1\.[A-Za-z0-9_.-]+)$/.exec(header);
  if (!match) return null;

  const token = openMcpAccessToken(match[1]);
  if (!token ||
      !/^[0-9a-f]{64}$/.test(token.accountHash) ||
      !/^[0-9a-f]{32}$/.test(token.grantId) ||
      !Number.isSafeInteger(token.expiresAt) ||
      token.expiresAt <= Date.now()) {
    return null;
  }

  const [account, grant] = await Promise.all([
    getUserDoc(token.accountHash),
    readMcpGrant(token.grantId)
  ]);

  if (!account || !grant ||
      grant.status !== 'active' ||
      token.grantId !== account.settings?.mcpGrantId ||
      typeof grant.accountId !== 'string' || !grant.accountId ||
      grant.accountId !== account.settings?.mcpAccountId ||
      grant.accountTag !== grantAccountTag(token.accountHash) ||
      !Array.isArray(grant.permissions) ||
      !grant.permissions.every(p => p === 'todo:read' || p === 'todo:write') ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= Date.now()) {
    return null;
  }

  return {
    accountHash: token.accountHash,
    grantId: token.grantId,
    permissions: grant.permissions
  };
}

/** Separate authenticated encryption domains for OAuth client and consent state. */
export function sealMcpState(purpose, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret(), iv);
  cipher.setAAD(Buffer.from(`workdeck-mcp-${purpose}-v1`));
  const data = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return ['wds1', iv.toString('base64url'), data.toString('base64url'),
    cipher.getAuthTag().toString('base64url')].join('.');
}

export function openMcpState(purpose, text) {
  try {
    if (typeof text !== 'string' || text.length > 4096) return null;
    const parts = text.split('.');
    if (parts.length !== 4 || parts[0] !== 'wds1') return null;
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', secret(), iv);
    decipher.setAAD(Buffer.from(`workdeck-mcp-${purpose}-v1`));
    decipher.setAuthTag(tag);
    const data = Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64url')),
      decipher.final()]);
    const value = JSON.parse(data.toString('utf8'));
    return Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now() ? value : null;
  } catch {
    return null;
  }
}
