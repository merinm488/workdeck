import { useState, useEffect, useCallback, useMemo } from 'react';
import * as db from '../lib/db';

/**
 * Docs Data Hook
 *
 * Manages all docs and tag operations:
 * - Fetch docs and tags
 * - Create, update, delete docs
 * - Create, update, delete tags
 * - Search functionality
 */
export function useDocs(userHash) {
  const [docs, setDocs] = useState([]);
  const [tags, setTags] = useState([]);
  const [activeTag, setActiveTag] = useState(null); // null = All Docs view
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  /**
   * Fetch all data for the user
   */
  const fetchData = useCallback(async () => {
    if (!userHash) {
      setHasLoaded(false);
      return;
    }

    setIsLoading(true);
    try {
      
      const userData = await db.getUserData(userHash);

      setDocs(userData?.docs || []);
      setTags(userData?.tags || []);
      setHasLoaded(true);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setDocs([]);
      setTags([]);
      setHasLoaded(true);
    }

    setIsLoading(false);
  }, [userHash]);

  /**
   * Create a new doc
   */
  const createDoc = useCallback(async (docData) => {
    if (!userHash) return null;

    const result = await db.createDoc(userHash, docData);
    // db.createDoc should return the created doc, not assume it's first
    const createdDoc = result.docs?.[0] || result;

    if (createdDoc) {
      setDocs(prev => [createdDoc, ...prev]);
    }
    return createdDoc;
  }, [userHash]);

  /**
   * Update an existing doc
   */
  const updateDoc = useCallback(async (docId, updates) => {
    if (!userHash) return null;

    const updatedDoc = await db.updateDoc(userHash, docId, updates);
    if (updatedDoc) {
      setDocs(prev =>
        prev.map(doc =>
          doc.id === docId ? updatedDoc : doc
        )
      );
    }
    return updatedDoc;
  }, [userHash]);

  /**
   * Delete a doc
   */
  const deleteDoc = useCallback(async (docId) => {
    if (!userHash) return false;

    const success = await db.deleteDoc(userHash, docId);
    if (success) {
      setDocs(prev => prev.filter(doc => doc.id !== docId));
    }
    return success;
  }, [userHash]);

  /**
   * Toggle doc pin status
   */
  const togglePin = useCallback(async (docId) => {
    if (!userHash) return null;

    const updatedDoc = await db.toggleDocPin(userHash, docId);
    if (updatedDoc) {
      setDocs(prev =>
        prev.map(doc =>
          doc.id === docId ? updatedDoc : doc
        )
      );
    }
    return updatedDoc;
  }, [userHash]);

  /**
   * Create a new tag
   */
  const createTag = useCallback(async (tagData) => {
    if (!userHash) return null;

    const newTag = await db.createTag(userHash, tagData);
    setTags(prev => [...prev, newTag]);
    return newTag;
  }, [userHash]);

  /**
   * Update a tag
   */
  const updateTag = useCallback(async (tagId, updates) => {
    if (!userHash) return null;

    const updatedTag = await db.updateTag(userHash, tagId, updates);
    if (updatedTag) {
      setTags(prev =>
        prev.map(tag =>
          tag.id === tagId ? updatedTag : tag
        )
      );
    }
    return updatedTag;
  }, [userHash]);

  /**
   * Delete a tag
   */
  const deleteTag = useCallback(async (tagId) => {
    if (!userHash) return false;

    const success = await db.deleteTag(userHash, tagId);
    if (success) {
      setTags(prev => prev.filter(tag => tag.id !== tagId));
      // Workdeck's suite-wide Delete Tag deletes single-tag documents (and
      // their public snapshots); keep Docs' local list in sync immediately.
      setDocs(prev => prev.filter(doc => doc.tagId !== tagId));

      // Clear active tag if it was deleted
      if (activeTag === tagId) {
        setActiveTag(null);
      }
    }
    return success;
  }, [userHash, activeTag]);

  /**
   * Get filtered docs based on active tag and search
   */
  const getFilteredDocs = useCallback(() => {
    // Make sure docs is an array
    if (!Array.isArray(docs)) {
      return [];
    }

    let filtered = docs;

    // Previously archived docs remain visible now that archive is no longer available.

    // Apply search filter - searches across all tags when there's a search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(doc =>
        doc.title.toLowerCase().includes(query) ||
        doc.content.toLowerCase().includes(query)
      );
    } else if (activeTag) {
      filtered = filtered.filter(doc => doc.tagId === activeTag);
    }
    // If activeTag is null (All Docs view), show all docs (already done above)

    // Sort: pinned first, then by date
    return filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  }, [docs, activeTag, searchQuery]);

  // Fetch data when user hash changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Memoize filtered docs to avoid expensive filtering on every render
  const filteredDocs = useMemo(getFilteredDocs, [getFilteredDocs]);

  return {
    docs,
    tags,
    activeTag,
    searchQuery,
    isLoading,
    hasLoaded,
    filteredDocs,
    setActiveTag,
    setSearchQuery,
    createDoc,
    updateDoc,
    deleteDoc,
    togglePin,
    createTag,
    updateTag,
    deleteTag,
    refreshData: fetchData
  };
}
