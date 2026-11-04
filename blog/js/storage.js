/**
 * ================================================
 * BLOG - Storage Module
 * ================================================
 *
 * All operations go through /api/blog, which reads/writes the user's
 * unified document (db/users/{hash}.json in dev, textdb.dev in prod).
 */

class BlogStorage {
    constructor() {
        this.apiEndpoint = APP_CONFIG.apiEndpoint;
    }

    async loadUserData() {
        const hash = getBlogUserHash();
        if (!hash) {
            console.error('[STORAGE] No user hash found');
            return null;
        }
        try {
            const response = await fetch(`${this.apiEndpoint}?hash=${encodeURIComponent(hash)}&_t=${Date.now()}`,
                { cache: 'no-store' }
            );
            if (!response.ok) return null;

            const result = await response.json();
            return result.success ? result.data : null;
        } catch (error) {
            console.error('[STORAGE] Load error:', error);
            return null;
        }
    }

    async request(action, data) {
        const hash = getBlogUserHash();
        if (!hash) return { success: false, error: 'No session' };
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hash, action, data: data || {} })
            });
            const result = await response.json();
            if (!result.success) {
                return { success: false, error: result.error || 'Request failed' };
            }
            return result;
        } catch (error) {
            console.error(`[STORAGE] ${action} error:`, error);
            return { success: false, error: 'Request failed' };
        }
    }

    // Creates a new draft post; resolves { post } from the response.
    async createPost(data) {
        const result = await this.request('createPost', data);
        return result.success ? { post: result.post, data: result.data } : null;
    }

    // The editor saves the whole body (title + html).
    async savePost(post) {
        const result = await this.request('updatePost', {
            id: post.id,
            title: post.title,
            html: post.html
        });
        return result;
    }

    async deletePost(postId) {
        const result = await this.request('deletePost', { id: postId });
        return result.success ? result.data : null;
    }

    // Publish resolves { blog: { postUrl, slug, path, publishedAt }, data }.
    // `slug` is the post's chosen public link (unique across accounts).
    async publishPost(postId, slug) {
        const result = await this.request('publishPost', { id: postId, slug });
        return result.success
            ? { publish: result.blog, data: result.data, error: null }
            : { publish: null, data: null, error: result.error };
    }

    async unpublishPost(postId) {
        const result = await this.request('unpublishPost', { id: postId });
        return result.success ? result.data : null;
    }

    async saveSettings(settings) {
        const result = await this.request('updateSettings', { settings });
        return result;
    }
}

const blogStorage = new BlogStorage();

if (typeof window !== 'undefined') {
    window.BlogStorage = BlogStorage;
    window.blogStorage = blogStorage;
}