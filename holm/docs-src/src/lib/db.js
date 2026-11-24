// Holm Docs storage adapter. Keep the original db.js exports/call sites,
// but never send the ignored legacy hash: Holm's verified member cookie owns
// the data. Per-doc queues serialize autosaves; server versions reject stale
// tabs rather than silently overwriting someone else's edit.
const API = '/api/docs';
const versions = new Map();
const pending = new Map();
const remember = data => {
  for (const doc of data?.docs || []) versions.set(doc.id, doc.version);
  return data;
};
async function call(url, method = 'GET', action, data) {
  const response = await fetch(url, {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(action ? { headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data }) } : {}),
  });
  if (response.status === 401) {
    location.assign('/auth/login?redirect=%2Fdocs%2F');
    throw new Error('Sign in to continue.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new Error(result.error || 'API request failed');
  return result;
}
const mutate = (url, action, data) => call(url, 'PUT', action, data);
function queue(docId, work) {
  const previous = pending.get(docId) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  pending.set(docId, current);
  current.finally(() => { if (pending.get(docId) === current) pending.delete(docId); }).catch(() => {});
  return current;
}
const version = id => {
  const v = versions.get(id);
  if (!Number.isSafeInteger(v)) throw new Error('Document has changed. Reload before editing.');
  return v;
};

export async function getUserData(_hash) {
  return remember((await call(API)).data);
}
export async function getDocs(hash) { return (await getUserData(hash)).docs; }
export async function createDoc(_hash, docData) {
  const result = await mutate(API, 'createDoc', docData);
  remember(result.data);
  return result.doc;
}
export function updateDoc(_hash, docId, updates) {
  return queue(docId, async () => {
    const result = await mutate(API, 'updateDoc', { docId, version: version(docId), updates });
    return remember(result.data).docs.find(doc => doc.id === docId) || null;
  });
}
export function deleteDoc(_hash, docId) {
  return queue(docId, async () => {
    await mutate(API, 'deleteDoc', { docId, version: version(docId) });
    versions.delete(docId);
    return true;
  });
}
export function toggleDocPin(_hash, docId) {
  return queue(docId, async () => {
    const result = await mutate(API, 'togglePin', { docId, version: version(docId) });
    return remember(result.data).docs.find(doc => doc.id === docId) || null;
  });
}
export async function getTags(hash) { return (await getUserData(hash)).tags || []; }
export async function createTag(_hash, tagData) {
  const result = await mutate('/api/workdeck', 'createTag', tagData);
  return result.data.tags[0];
}
export async function updateTag(_hash, tagId, updates) {
  const result = await mutate('/api/workdeck', 'updateTag', { tagId, updates });
  return result.data.tags.find(tag => tag.id === tagId) || null;
}
export async function deleteTag(_hash, tagId) {
  await mutate('/api/workdeck', 'deleteTag', { tagId });
  return true;
}
export function shareDoc(_hash, docId) {
  return queue(docId, async () => {
    const result = await mutate(API, 'shareDoc', { docId, version: version(docId) });
    if (result.version) versions.set(docId, result.version);
    return result;
  });
}
export async function getSharedDoc(shareId) {
  try { return await call(`${API}?shared=${encodeURIComponent(shareId)}`); }
  catch (error) { if (error.message === 'Shared doc not found') return null; throw error; }
}
