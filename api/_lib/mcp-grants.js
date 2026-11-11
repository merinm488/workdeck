import crypto from 'node:crypto';
import { getRawDoc, putRawDoc, deleteRawDoc } from './store.js';

function secret() {
  const value = process.env.MCP_AUTH_SECRET;
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('MCP_AUTH_SECRET must be a 32-byte hex value');
  }
  return Buffer.from(value, 'hex');
}

function grantKey(grantId) {
  if (!/^[0-9a-f]{32}$/.test(grantId)) {
    throw new Error('Invalid MCP grant ID');
  }
  return 'mcp_grant_' + crypto
    .createHmac('sha256', secret())
    .update(grantId)
    .digest('hex');
}

export function newGrantId() {
  return crypto.randomBytes(16).toString('hex');
}

/** Bind a connection to the key-derived address without storing that address. */
export function grantAccountTag(accountHash) {
  if (!/^[a-f0-9]{64}$/.test(accountHash)) throw new Error('Invalid account address');
  return crypto.createHmac('sha256', secret()).update(`account:${accountHash}`).digest('hex');
}

export async function readMcpGrant(grantId) {
  return getRawDoc(grantKey(grantId));
}

export async function writeMcpGrant(grantId, grant) {
  return putRawDoc(grantKey(grantId), grant);
}

export async function deleteMcpGrant(grantId) {
  return deleteRawDoc(grantKey(grantId));
}

// OAuth codes use independent, per-code records, never the unified account
// document. All calls go through this adapter so changing storage is local.
function codeKey(code) {
  if (!/^[0-9a-f]{64}$/.test(code)) throw new Error('Invalid OAuth code');
  return 'mcp_code_' + crypto.createHmac('sha256', secret()).update(code).digest('hex');
}

export async function readMcpCode(code) {
  return getRawDoc(codeKey(code));
}

export async function writeMcpCode(code, record) {
  return putRawDoc(codeKey(code), record);
}
