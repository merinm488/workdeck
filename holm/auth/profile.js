// Workdeck-specific overrides stay private to the verified member. Holm owns
// the original sign-in photo (including Google); never modify that identity.
const KEY = 'workdeck_profile_photo';
const MAX_PHOTO = 60_000;
const json = (value, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export function memberProfile(member, kv) {
  const photo = kv.get(KEY);
  return {
    picture: typeof photo === 'string' && photo ? photo : member.picture || '',
    hasCustomPhoto: typeof photo === 'string' && !!photo,
  };
}

export async function handleProfile(request, env) {
  const member = env.holm.auth.getMember();
  if (!member) return json({ error: 'Sign in to change your photo.' }, 401);
  if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid origin.' }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return json({ error: 'JSON required.' }, 400);
  const raw = await request.text();
  if (raw.length > MAX_PHOTO + 100) return json({ error: 'Photo is too large.' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !Object.hasOwn(body, 'photo')) return json({ error: 'Invalid photo.' }, 400);
  // The browser re-encodes uploads as small JPEGs. No arbitrary URLs, SVGs,
  // client-selected member IDs, or identity credentials may be persisted.
  const photo = body.photo;
  if (photo !== null && (typeof photo !== 'string' || photo.length > MAX_PHOTO ||
      !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(photo) ||
      (photo.length - 'data:image/jpeg;base64,'.length) % 4 !== 0)) return json({ error: 'Choose a valid photo.' }, 400);
  const { kv } = env.holm.app.member;
  kv.set(KEY, photo);
  return json(memberProfile(member, kv));
}
