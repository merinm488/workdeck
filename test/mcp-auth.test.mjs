import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'development';
process.env.MCP_AUTH_SECRET = crypto.randomBytes(32).toString('hex');

const { generateHash, createUserDoc, deleteUserDoc, changeUserKey } =
  await import('../api/_lib/store.js');
const { newGrantId, grantAccountTag, writeMcpGrant, deleteMcpGrant } =
  await import('../api/_lib/mcp-grants.js');
const { sealMcpAccessToken, authenticateMcpBearer } =
  await import('../api/_lib/mcp-auth.js');

test('MCP token binds to one existing account and a revocable grant', async () => {
  const accountHash = generateHash(`mcp-test-${crypto.randomUUID()}`);
  const accountId = crypto.randomUUID();
  const grantId = newGrantId();
  const expiresAt = Date.now() + 60_000;

  try {
    const created = await createUserDoc(accountHash, {
      mcpAccountId: accountId, mcpGrantId: grantId
    });
    assert.equal(created.ok, true);

    assert.equal(await writeMcpGrant(grantId, {
      status: 'active',
      accountId, accountTag: grantAccountTag(accountHash),
      permissions: ['todo:read', 'todo:write'],
      expiresAt
    }), true);

    const token = sealMcpAccessToken({
      accountHash, grantId, expiresAt
    });
    assert.equal(token.includes(accountHash), false);

    const binding = await authenticateMcpBearer(`Bearer ${token}`);
    assert.equal(binding.accountHash, accountHash);
    assert.deepEqual(binding.permissions, ['todo:read', 'todo:write']);

    assert.equal(
      await authenticateMcpBearer('Bearer invalid-token'),
      null
    );

    // A grant must never authenticate just because both account markers are absent.
    assert.equal(await writeMcpGrant(grantId, {
      status: 'active', permissions: ['todo:read'], expiresAt
    }), true);
    assert.equal(await authenticateMcpBearer(`Bearer ${token}`), null);

    assert.equal(await writeMcpGrant(grantId, {
      status: 'revoked',
      accountId, accountTag: grantAccountTag(accountHash),
      permissions: ['todo:read', 'todo:write'],
      expiresAt
    }), true);
    assert.equal(
      await authenticateMcpBearer(`Bearer ${token}`),
      null
    );
  } finally {
    await deleteMcpGrant(grantId);
    await deleteUserDoc(accountHash);
  }
});

test('changing the account key invalidates MCP tokens even if the old key is reused', async () => {
  const key = `mcp-rotate-${crypto.randomUUID()}`;
  const accountHash = generateHash(key);
  const accountId = crypto.randomUUID();
  const grantId = newGrantId();
  const expiresAt = Date.now() + 60_000;
  let newHash;
  try {
    assert.equal((await createUserDoc(accountHash, {
      mcpAccountId: accountId, mcpGrantId: grantId
    })).ok, true);
    assert.equal(await writeMcpGrant(grantId, {
      status: 'active', accountId, accountTag: grantAccountTag(accountHash),
      permissions: ['todo:read', 'todo:write'], expiresAt
    }), true);
    const token = sealMcpAccessToken({ accountHash, grantId, expiresAt });
    assert.ok(await authenticateMcpBearer(`Bearer ${token}`));
    const moved = await changeUserKey(accountHash, `new-${key}`);
    assert.equal(moved.ok, true);
    newHash = moved.hash;
    assert.equal(await authenticateMcpBearer(`Bearer ${token}`), null);
    assert.equal((await createUserDoc(accountHash)).ok, true);
    assert.equal(await authenticateMcpBearer(`Bearer ${token}`), null);
  } finally {
    await deleteMcpGrant(grantId);
    await deleteUserDoc(accountHash);
    if (newHash) await deleteUserDoc(newHash);
  }
});
