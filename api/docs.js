/**
 * ================================================
 * DOCS - API
 * ================================================
 *
 *  1. Storage goes through the shared store module so the SAME document works
 *     with local JSON files in development and textdb.dev in production.
 *  2. Saves are section-merged (saveOwnedSections), so writing docs/tags can
 *     never wipe the user's sheets or Workdeck settings.
 */

import {
  generateHash,
  generateId,
  getUserDoc,
  saveOwnedSections,
  createUserDoc,
  deleteUserDoc,
  putSharedDoc,
  getSharedDoc,
  deleteSharedDoc,
  getBaseUrl,
  applyCorsHeaders
} from './_lib/store.js';

/**
 * Persist only the sections this app owns (docs, tags) plus the settings it
 * changed, merging over the rest of the document.
 */
async function saveDocsSections(hash, userData) {
  return saveOwnedSections(hash, {
    docs: userData.docs,
    tags: userData.tags,
    settings: userData.settings
  });
}

// ==================== HANDLERS ====================

/**
 * GET /api/docs?hash={hash} | /api/docs?shared={shareId}
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const hash = searchParams.get('hash');
    const shared = searchParams.get('shared');

    if (shared) {
      console.log(`[API GET] Fetching shared doc: ${shared}`);
      const doc = await getSharedDoc(shared);

      if (!doc || !doc.doc) {
        return Response.json({ error: 'Shared doc not found' }, { status: 404 });
      }

      return Response.json({
        success: true,
        doc: doc.doc,
        sharedAt: doc.sharedAt
      });
    }

    if (!hash) {
      return Response.json({ error: 'Hash is required' }, { status: 400 });
    }

    const userData = await getUserDoc(hash);
    if (!userData) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    return Response.json({ success: true, data: userData });
  } catch (error) {
    console.error('[API GET] Error:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

/**
 * POST /api/docs — login or account creation.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { key, action } = body;

    if (!key) {
      return Response.json({ error: 'Key is required' }, { status: 400 });
    }

    const normalizedKey = key.trim();
    if (normalizedKey.length === 0) {
      return Response.json({ error: 'Key cannot be empty' }, { status: 400 });
    }

    const hash = generateHash(normalizedKey);

    if (action === 'login') {
      const userData = await getUserDoc(hash);
      if (!userData) {
        return Response.json({ error: 'User not found' }, { status: 404 });
      }
      return Response.json({ success: true, hash, data: userData });
    }

    const result = await createUserDoc(hash, { theme: 'dark' });
    if (!result.ok) {
      if (result.code === 'USER_EXISTS') {
        return Response.json({ error: 'User already exists', code: 'USER_EXISTS' }, { status: 409 });
      }
      return Response.json({ error: 'Failed to create account' }, { status: 500 });
    }

    return Response.json({
      success: true,
      hash,
      message: 'Account created successfully',
      data: result.doc
    });
  } catch (error) {
    console.error('[API POST] Error:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

/**
 * PUT /api/docs — doc/tag mutations.
 */
export async function PUT(request) {
  try {
    const baseUrl = getBaseUrl(request);
    const body = await request.json();
    const { hash, action, data } = body;

    if (!hash || !action) {
      return Response.json({ error: 'Hash and action are required' }, { status: 400 });
    }

    const userData = await getUserDoc(hash);
    if (!userData) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    switch (action) {
      case 'createDoc': {
        const newDoc = {
          id: generateId(),
          title: data.title || 'Untitled',
          content: data.content || '',
          contentType: data.contentType || 'plain-text',
          tagId: data.tagId || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          pinned: false,
          archived: false
        };
        userData.docs.unshift(newDoc);
        break;
      }

      case 'updateDoc': {
        const docIndex = userData.docs.findIndex(n => n.id === data.docId);
        if (docIndex === -1) {
          return Response.json({ error: 'Doc not found' }, { status: 404 });
        }
        userData.docs[docIndex] = {
          ...userData.docs[docIndex],
          ...data.updates,
          id: data.docId,
          createdAt: userData.docs[docIndex].createdAt,
          updatedAt: new Date().toISOString()
        };

        if (userData.docs[docIndex].sharedId) {
          try {
            await putSharedDoc(userData.docs[docIndex].sharedId, {
              doc: userData.docs[docIndex],
              sharedAt: new Date().toISOString()
            });
          } catch (e) {
            console.error('[API PUT] Failed to update shared copy:', e);
          }
        }
        break;
      }

      case 'deleteDoc': {
        const docToDelete = userData.docs.find(n => n.id === data.docId);
        if (docToDelete?.sharedId) {
          try {
            await deleteSharedDoc(docToDelete.sharedId);
          } catch (e) {
            console.error('[API PUT] Failed to delete shared copy:', e);
          }
        }
        userData.docs = userData.docs.filter(n => n.id !== data.docId);
        break;
      }

      case 'shareDoc': {
        const shareDocIndex = userData.docs.findIndex(n => n.id === data.docId);
        if (shareDocIndex === -1) {
          return Response.json({ error: 'Doc not found' }, { status: 404 });
        }

        if (userData.docs[shareDocIndex].sharedId) {
          const existingShareId = userData.docs[shareDocIndex].sharedId;
          return Response.json({
            success: true,
            shareId: existingShareId,
            shareUrl: `${baseUrl}/docs/?shared=${existingShareId}`,
            alreadyShared: true
          });
        }

        const newShareId = generateId();
        const shareData = {
          doc: userData.docs[shareDocIndex],
          sharedAt: new Date().toISOString()
        };

        try {
          await putSharedDoc(newShareId, shareData);
        } catch (e) {
          console.error('[API PUT] Failed to save shared doc:', e);
          return Response.json({ error: 'Failed to create share' }, { status: 500 });
        }

        userData.docs[shareDocIndex].sharedId = newShareId;
        await saveDocsSections(hash, userData);

        return Response.json({
          success: true,
          shareId: newShareId,
          shareUrl: `${baseUrl}/docs/?shared=${newShareId}`,
          alreadyShared: false
        });
      }

      case 'togglePin': {
        const doc = userData.docs.find(n => n.id === data.docId);
        if (doc) {
          doc.pinned = !doc.pinned;
          doc.updatedAt = new Date().toISOString();

          if (doc.sharedId) {
            try {
              await putSharedDoc(doc.sharedId, {
                doc,
                sharedAt: new Date().toISOString()
              });
            } catch (e) {
              console.error('[API PUT] Failed to update shared copy:', e);
            }
          }
        }
        break;
      }

      case 'toggleArchive': {
        const docToArchive = userData.docs.find(n => n.id === data.docId);
        if (docToArchive) {
          docToArchive.archived = !docToArchive.archived;
          if (docToArchive.archived) {
            docToArchive.pinned = false;
          }
          docToArchive.updatedAt = new Date().toISOString();

          if (docToArchive.sharedId) {
            try {
              await putSharedDoc(docToArchive.sharedId, {
                doc: docToArchive,
                sharedAt: new Date().toISOString()
              });
            } catch (e) {
              console.error('[API PUT] Failed to update shared copy:', e);
            }
          }
        }
        break;
      }

      case 'createTag': {
        const newTag = {
          id: generateId(),
          name: data.name || 'New Tag',
          color: data.color || '#FACC15'
        };
        if (!userData.tags) userData.tags = [];
        userData.tags.push(newTag);
        break;
      }

      case 'updateTag': {
        const tagIndex = (userData.tags || []).findIndex(t => t.id === data.tagId);
        if (tagIndex === -1) {
          return Response.json({ error: 'Tag not found' }, { status: 404 });
        }
        userData.tags[tagIndex] = {
          ...userData.tags[tagIndex],
          ...data.updates,
          id: data.tagId
        };
        break;
      }

      case 'deleteTag': {
        const deleteTagIndex = (userData.tags || []).findIndex(t => t.id === data.tagId);
        if (deleteTagIndex === -1) {
          return Response.json({ error: 'Tag not found' }, { status: 404 });
        }
        userData.docs.forEach(n => {
          if (n.tagId === data.tagId) {
            n.tagId = null;
          }
        });
        userData.tags = userData.tags.filter(t => t.id !== data.tagId);
        break;
      }

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    const saved = await saveDocsSections(hash, userData);
    if (saved) {
      return Response.json({ success: true, data: userData });
    }
    return Response.json({ error: 'Failed to save data' }, { status: 500 });
  } catch (error) {
    console.error('[API PUT] Error:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/docs — delete account.
 */
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const hash = searchParams.get('hash');

    if (!hash) {
      return Response.json({ error: 'Hash is required' }, { status: 400 });
    }

    const userData = await getUserDoc(hash);
    if (!userData) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    await deleteUserDoc(hash);
    return Response.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    console.error('[API DELETE] Error:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

// applyCorsHeaders is used by the dev server when adapting these handlers.
export { applyCorsHeaders };
