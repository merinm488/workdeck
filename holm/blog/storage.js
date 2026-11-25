// Blog's authenticated Holm API. No legacy account hash or access key is
// sent by this client; the server always selects the verified member scope.
const blogStorage = {
    async loadUserData() {
        try {
            const response = await (window.WDBoot?.fetch || fetch)('/api/blog', { credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) return null;
            const result = await response.json();
            return result.success ? result.data : null;
        } catch (error) { console.error('[BLOG] Load error', error); return null; }
    },
    async request(action, data = {}, path = '/api/blog') {
        try {
            const response = await (window.WDBoot?.fetch || fetch)(path, { method: 'PUT', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, data }) });
            return await response.json();
        } catch (error) { console.error('[BLOG] Request failed', action, error);
            return { success: false, error: 'Request failed' }; }
    },
    async createPost(data) {
        const result = await this.request('createPost', data);
        return result.success ? { post: result.post, data: result.data } : null;
    },
    savePost(post) {
        return this.request('updatePost', { id: post.id, title: post.title, html: post.html });
    },
    async deletePost(id) {
        const result = await this.request('deletePost', { id });
        return result.success ? result.data : null;
    },
    async publishPost(id, slug) {
        const result = await this.request('publishPost', { id, slug });
        return result.success ? { publish: result.blog, data: result.data, error: null }
            : { publish: null, data: null, error: result.error };
    },
    async unpublishPost(id) {
        const result = await this.request('unpublishPost', { id });
        return result.success ? result.data : null;
    },
    async saveSettings(settings) {
        if (settings.theme) return this.request('updateSettings', { settings: { theme: settings.theme } }, '/api/workdeck');
        if (settings.lastOpened) {
            const [id] = Object.keys(settings.lastOpened).sort((a, b) =>
                String(settings.lastOpened[b]).localeCompare(String(settings.lastOpened[a])));
            if (id) return this.request('recordOpen', { app: 'blog', fileId: id }, '/api/workdeck');
        }
        return { success: false, error: 'Unsupported settings' };
    },
};
