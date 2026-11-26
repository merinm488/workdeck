import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleProfile, memberProfile } from '../holm/auth/profile.js';
import { withProfilePhotos } from '../holm/auth/account-build.mjs';
const origin = 'https://workdeck.test';
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
function fixture() {
  const stores = new Map();
  let member = { id: 'alice', picture: origin + '/_holm/members/alice/avatar?v=google' };
  const kv = {
    get: key => stores.get(member.id)?.get(key),
    set: (key, value) => {
      if (!stores.has(member.id)) stores.set(member.id, new Map());
      stores.get(member.id).set(key, value);
    },
  };
  return { env: { holm: { auth: { getMember: () => member }, app: { member: { kv } } } },
    kv, setMember: value => { member = value; }, member: () => member };
}
function request(body, options = {}) {
  return new Request(origin + '/api/profile', { method: 'PUT',
    headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options });
}

test('profile uses Holm sign-in picture, overrides it, and can restore it without touching other settings', async () => {
  const f = fixture(); f.kv.set('workdeck_settings', { theme: 'light' });
  assert.deepEqual(memberProfile(f.member(), f.kv), { picture: f.member().picture, hasCustomPhoto: false });
  const saved = await handleProfile(request({ photo: jpeg }), f.env);
  assert.equal(saved.status, 200); assert.equal(saved.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await saved.json(), { picture: jpeg, hasCustomPhoto: true });
  assert.equal(memberProfile(f.member(), f.kv).picture, jpeg);
  const restored = await handleProfile(request({ photo: null }), f.env);
  assert.deepEqual(await restored.json(), { picture: f.member().picture, hasCustomPhoto: false });
  assert.deepEqual(f.kv.get('workdeck_settings'), { theme: 'light' });
});

test('photos are isolated by the verified member; signed-out writes fail', async () => {
  const f = fixture(); await handleProfile(request({ photo: jpeg }), f.env);
  const alice = f.member(); f.setMember({ id: 'bob', picture: '' });
  assert.deepEqual(memberProfile(f.member(), f.kv), { picture: '', hasCustomPhoto: false });
  f.setMember(alice); assert.equal(memberProfile(f.member(), f.kv).picture, jpeg);
  f.setMember(null); assert.equal((await handleProfile(request({ photo: jpeg }), f.env)).status, 401);
});

test('profile writes reject foreign/missing origins, unsupported methods, bad JSON and oversize payloads', async () => {
  const f = fixture();
  for (const attack of ['https://evil.test', '', 'null']) {
    assert.equal((await handleProfile(request({ photo: jpeg }, { headers: { origin: attack, 'Content-Type': 'application/json' } }), f.env)).status, 403);
  }
  assert.equal((await handleProfile(new Request(origin + '/api/profile'), f.env)).status, 405);
  assert.equal((await handleProfile(request({ photo: jpeg }, { headers: { origin, 'Content-Type': 'text/plain' } }), f.env)).status, 400);
  assert.equal((await handleProfile(request(null, { body: '{' }), f.env)).status, 400);
  assert.equal((await handleProfile(request({ photo: 'x'.repeat(60100) }), f.env)).status, 413);
  for (const body of [null, [], {}, { photo: jpeg, memberId: 'bob' }, { photo: jpeg, key: 'legacy' },
    { photo: {} }, { photo: '' }, { photo: 'https://evil.test/a.jpg' }, { photo: 'data:image/svg+xml,<svg/>' },
    { photo: 'data:image/jpeg;base64,YmFk' }, { photo: jpeg + '!' }]) {
    assert.equal((await handleProfile(request(body), f.env)).status, 400, JSON.stringify(body));
  }
  assert.equal(f.kv.get('workdeck_profile_photo'), undefined);
});

test('profile resources attach to the outer document, never embedded preview HTML', () => {
  const html = '<head></head><body><textarea><body></body></textarea></body>';
  const built = withProfilePhotos(html);
  assert.match(built, /profile-photo\.css/);
  assert.match(built, /<\/textarea><script defer src="\/js\/profile-photo\.js"><\/script><\/body>$/);
  assert.throws(() => withProfilePhotos('bad'), /Missing body/);
});
