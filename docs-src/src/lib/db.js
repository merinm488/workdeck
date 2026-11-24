/**
 * TextDB Client
 *
 * This module communicates with the TextDB backend via REST API
 * All data is stored as JSON files on the server
 */

const API_BASE = '/api/docs';

// ===== API HELPERS =====

/**
 * Make API request
 */
async function apiRequest(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'API request failed');
    }

    return data;
  } catch (error) {
    console.error('API request error:', error);
    throw error;
  }
}

// ===== USER OPERATIONS =====

/**
 * Get user data by hash
 * @param {string} hash - The hashed key
 * @returns {Promise<Object|null>} - User data or null if not found
 */
export async function getUserData(hash) {
  try {
    const response = await apiRequest(`?hash=${encodeURIComponent(hash)}`);
    return response.data;
  } catch (error) {
    if (error.message === 'User not found') {
      return null;
    }
    throw error;
  }
}

// ===== DOC OPERATIONS =====

/**
 * Create a new doc
 * @param {string} hash - User's hash
 * @param {Object} docData - Doc content { title, content, folderId }
 * @returns {Promise<Object>} - The created doc
 */
export async function createDoc(hash, docData) {
  const response = await apiRequest('', {
    method: 'PUT',
    body: JSON.stringify({
      hash,
      action: 'createDoc',
      data: docData
    })
  });

  return response.data.docs[0]; // First doc is the newly created one
}

/**
 * Get all docs for a user
 * @param {string} hash - User's hash
 * @returns {Promise<Array>} - Array of docs
 */
export async function getDocs(hash) {
  const userData = await getUserData(hash);
  return userData ? userData.docs : [];
}


/**
 * Update an existing doc
 * @param {string} hash - User's hash
 * @param {string} docId - Doc ID to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object|null>} - Updated doc or null
 */
export async function updateDoc(hash, docId, updates) {
  const response = await apiRequest('', {
    method: 'PUT',
    body: JSON.stringify({
      hash,
      action: 'updateDoc',
      data: { docId, updates }
    })
  });

  return response.data.docs.find(n => n.id === docId) || null;
}

/**
 * Delete a doc
 * @param {string} hash - User's hash
 * @param {string} docId - Doc ID to delete
 * @returns {Promise<boolean>} - Success status
 */
export async function deleteDoc(hash, docId) {
  await apiRequest('', {
    method: 'PUT',
    body: JSON.stringify({
      hash,
      action: 'deleteDoc',
      data: { docId }
    })
  });

  return true;
}

/**
 * Toggle doc pin status
 * @param {string} hash - User's hash
 * @param {string} docId - Doc ID
 * @returns {Promise<Object|null>} - Updated doc or null
 */
export async function toggleDocPin(hash, docId) {
  const response = await apiRequest('', {
    method: 'PUT',
    body: JSON.stringify({
      hash,
      action: 'togglePin',
      data: { docId }
    })
  });

  return response.data.docs.find(n => n.id === docId) || null;
}

// ===== TAG OPERATIONS =====

/**
 * Get all tags for a user
 * @param {string} hash - User's hash
 * @returns {Promise<Array>} - Array of tags
 */
export async function getTags(hash) {
  const userData = await getUserData(hash);
  return userData ? userData.tags || [] : [];
}

/**
 * Create a new tag
 * @param {string} hash - User's hash
 * @param {Object} tagData - { name, color }
 * @returns {Promise<Object>} - Created tag
 */
export async function createTag(hash, tagData) {
  const response = await apiRequest('', {
    method: 'PUT',
    body: JSON.stringify({
      hash,
      action: 'createTag',
      data: tagData
    })
  });

  const tags = response.data.tags || [];
  return tags[tags.length - 1]; // Last tag is the new one
}

/**
 * Update a tag
 * @param {string} hash - User's hash
 * @param {string} tagId - Tag ID
 * @param {Object} updates - { name, color }
 * @returns {Promise<Object|null>} - Updated tag or null
 */
export async function updateTag(hash, tagId, updates) {
  const response = await apiRequest('', {
    method: 'PUT',
    body: JSON.stringify({
      hash,
      action: 'updateTag',
      data: { tagId, updates }
    })
  });

  const tags = response.data.tags || [];
  return tags.find(t => t.id === tagId) || null;
}

/**
 * Delete a tag
 * @param {string} hash - User's hash
 * @param {string} tagId - Tag ID
 * @returns {Promise<boolean>} - Success status
 */
export async function deleteTag(hash, tagId) {
  try {
    await apiRequest('', {
      method: 'PUT',
      body: JSON.stringify({
        hash,
        action: 'deleteTag',
        data: { tagId }
      })
    });
    return true;
  } catch (error) {
    if (error.message === 'Tag not found') {
      return false;
    }
    throw error;
  }
}

// ===== SEARCH OPERATIONS =====


// ===== SHARE OPERATIONS =====

/**
 * Share a doc and get public URL
 * @param {string} hash - User's hash
 * @param {string} docId - Doc ID to share
 * @returns {Promise<Object>} - { shareId, shareUrl, alreadyShared }
 */
export async function shareDoc(hash, docId) {
  const response = await apiRequest('', {
    method: 'PUT',
    body: JSON.stringify({
      hash,
      action: 'shareDoc',
      data: { docId }
    })
  });

  return response; // { shareId, shareUrl, alreadyShared }
}

/**
 * Get a shared doc by share ID
 * @param {string} shareId - Share ID
 * @returns {Promise<Object|null>} - Shared doc data or null
 */
export async function getSharedDoc(shareId) {
  try {
    const response = await apiRequest(`?shared=${encodeURIComponent(shareId)}`);
    return response;
  } catch (error) {
    if (error.message === 'Shared doc not found') {
      return null;
    }
    throw error;
  }
}

// ===== UTILITY FUNCTIONS =====

