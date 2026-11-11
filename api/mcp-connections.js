import { accountHash, getUserDoc } from './_lib/store.js';
import { readMcpGrant, writeMcpGrant, grantAccountTag } from './_lib/mcp-grants.js';

/** Management uses the existing Workdeck browser session credential. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const hash = accountHash(req.method === 'GET' ? req.query : req.body);
    if (!hash) return res.status(401).json({ error: 'Account key or session is required' });
    const account = await getUserDoc(hash);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const grantId = account.settings.mcpGrantId;
    const grant = grantId && await readMcpGrant(grantId);
    if (req.method === 'GET') {
      const active = grant && grant.status === 'active' &&
        grant.accountId === account.settings.mcpAccountId &&
        grant.accountTag === grantAccountTag(hash) && grant.expiresAt > Date.now();
      return res.status(200).json({ connection: active ? {
        clientName: grant.clientName, createdAt: grant.createdAt,
        expiresAt: grant.expiresAt, permissions: grant.permissions
      } : null });
    }
    if (grant && grant.status === 'active' && grant.accountTag === grantAccountTag(hash) &&
        !(await writeMcpGrant(grantId, { ...grant, status: 'revoked' }))) {
      return res.status(503).json({ error: 'Could not revoke connection' });
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[MCP] Connection management failed:', error);
    return res.status(503).json({ error: 'Connection management unavailable' });
  }
}
