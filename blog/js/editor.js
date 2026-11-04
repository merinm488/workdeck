/**
 * ================================================
 * BLOG - Post Editor (Quill)
 * ================================================
 *
 * The live post record is the source of truth — every mutation lands on
 * this.post, then scheduleSave() debounces a whole-body PUT. The
 * sanitized persistence copy is built server-side (api/_lib/posts.js),
 * so the client never assigns the saved result back into the model.
 *
 * The toolbar's image button is remapped to an insert-by-URL modal:
 * posts embed images by link, never as base64 blobs.
 *
 * The gear menu's publish section (wired in app.js) opens the publish
 * modal for the open post: the post's public link slug — editable until
 * the post publishes, then locked (unpublish to change it) — then
 * publish; copy/open of the public link and unpublish follow.
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

const BlogEditor = {
    quill: null,
    post: null,
    saveTimer: null,
    saving: false,
    pendingSave: false,
    suppressChange: false,
    unpublishArmed: false,
    unpublishTimer: null,

    init() {
        this.quill = new Quill('#editorMount', {
            theme: 'snow',
            placeholder: 'Write your post…',
            modules: {
                toolbar: {
                    container: [
                        [{ header: [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ list: 'ordered' }, { list: 'bullet' }],
                        ['blockquote', 'code-block'],
                        ['link', 'image'],
                        ['clean']
                    ],
                    handlers: {
                        // No image uploads: route the toolbar button to the URL modal.
                        image: () => this.openImageModal()
                    }
                }
            }
        });

        this.quill.on('text-change', () => this.onTextChange());

        $('postTitleInput').addEventListener('input', (e) => {
            if (!this.post) return;
            this.post.title = e.target.value;
            this.scheduleSave();
        });

        $('deletePostBtn').addEventListener('click', () => this.openDeleteModal());
        $('backToPosts').addEventListener('click', () => this.close());

        // Publish post modal (opened from the gear menu's Publish item)
        $('publishPostModalClose').addEventListener('click', () => this.closePublishPostModal());
        $('confirmPublishPost').addEventListener('click', () => this.confirmPublishPost());
        $('confirmUnpublishPost').addEventListener('click', () => this.confirmUnpublishPost());
        $('pubCopyBtn').addEventListener('click', () => this.copyPostLink());
        $('pubSlugInput').addEventListener('input', () => $('pubError').classList.add('hidden'));
        $('publishPostModal').addEventListener('click', (e) => {
            if (e.target === $('publishPostModal')) this.closePublishPostModal();
        });
        $('pubSlugInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.confirmPublishPost();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            this.closePublishPostModal();
        });

        // Delete modal
        $('deletePostModalClose').addEventListener('click', () => this.closeDeleteModal());
        $('cancelDeletePost').addEventListener('click', () => this.closeDeleteModal());
        $('confirmDeletePost').addEventListener('click', () => this.confirmDelete());
        $('deletePostModal').addEventListener('click', (e) => {
            if (e.target === $('deletePostModal')) this.closeDeleteModal();
        });

        // Image modal
        $('imageUrlInput').addEventListener('input', () => $('imageError').classList.add('hidden'));
        $('imageUrlInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.confirmImage();
        });
    },

    // ================================================
    // Open / close
    // ================================================

    open(post) {
        this.post = post;
        clearTimeout(this.saveTimer);
        this.saving = false;
        this.pendingSave = false;

        $('postTitleInput').value = post.title || '';
        this.setIndicator('saved');

        this.suppressChange = true;
        this.quill.clipboard.dangerouslyPasteHTML(post.html || '<p><br></p>');
        this.suppressChange = false;
        this.quill.setSelection(0);
        refreshPublishMenu();
    },

    close() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            this.save();
        }
        window.BlogApp.showPostsView();
    },

    // ================================================
    // Publish (per post; the author picks the post's public link).
    // The gear menu's publish entries live in app.js (refreshPublishMenu)
    // and open this modal.
    // ================================================

    async openPublishPostModal() {
        if (!this.post) return;
        clearTimeout(this.saveTimer);
        await this.save();   // publish what the editor shows

        $('pubPostName').textContent = `“${this.post.title || 'Untitled'}”`;
        $('pubError').classList.add('hidden');
        this.syncSlugField();
        this.refreshPublishModal();
        $('publishPostModal').classList.remove('hidden');
    },

    closePublishPostModal() {
        $('publishPostModal').classList.add('hidden');
        this.disarmUnpublish();
    },

    // Blog name + the post's link slug. The slug is editable until this
    // post publishes, then locked (unpublish to change it).
    syncSlugField() {
        const published = Boolean(this.post && this.post.publishedAt);
        const slugInput = $('pubSlugInput');
        slugInput.disabled = published;
        $('pubSlugRow').classList.toggle('locked', published);
        slugInput.value = this.post.slug || '';
        const hint = $('pubSlugHint');
        if (published) {
            const blog = blogConfig();
            $('pubSlugPrefix').textContent = this.post.path
                ? location.origin + '/'
                : location.origin + '/' + (blog.address ? blog.address.slug + '/' : '');
            hint.textContent = 'This link is live — unpublish the post to change it.';
            hint.classList.remove('hidden');
        } else {
            $('pubSlugPrefix').textContent = location.origin + '/';
            hint.classList.add('hidden');
        }
    },

    refreshPublishModal() {
        const published = Boolean(this.post && this.post.publishedAt);
        $('confirmPublishPost').classList.toggle('hidden', published);
        $('confirmUnpublishPost').classList.toggle('hidden', !published);
        $('pubLiveCard').classList.toggle('hidden', !published);
        if (published) {
            const path = postPublicPath(this.post);
            $('pubLiveUrl').textContent = location.origin + path;
            $('pubOpenLink').href = location.origin + path;
            const since = Date.parse(this.post.publishedAt || '');
            $('pubLiveSince').textContent = isNaN(since)
                ? '' : 'since ' + new Date(since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }
    },

    showPubError(message) {
        const el = $('pubError');
        el.textContent = message;
        el.classList.remove('hidden');
    },

    async confirmPublishPost() {
        const slug = $('pubSlugInput').value.trim().toLowerCase();
        if (!SLUG_RE.test(slug)) {
            this.showPubError('Use 3-40 lowercase letters, digits or hyphens.');
            return;
        }

        $('pubError').classList.add('hidden');
        const btn = $('confirmPublishPost');
        btn.disabled = true;
        const result = await blogStorage.publishPost(this.post.id, slug);
        btn.disabled = false;

        if (!result.publish) {
            this.showPubError(result.error || 'Publishing failed');
            return;
        }
        state.settings = mergeSettings(state.settings, result.data);
        this.post.slug = result.publish.slug;
        this.post.path = result.publish.path;
        this.post.publishedAt = result.publish.publishedAt;
        this.syncSlugField();
        this.refreshPublishModal();
        refreshPublishMenu();
        window.BlogApp.showToast('Published at ' + result.publish.postUrl.replace(location.origin, ''));
    },

    disarmUnpublish() {
        this.unpublishArmed = false;
        clearTimeout(this.unpublishTimer);
        const btn = $('confirmUnpublishPost');
        btn.textContent = 'Unpublish';
        btn.classList.remove('armed');
    },

    async confirmUnpublishPost() {
        const btn = $('confirmUnpublishPost');
        if (!this.unpublishArmed) {
            this.unpublishArmed = true;
            btn.textContent = 'Click again to confirm';
            btn.classList.add('armed');
            this.unpublishTimer = setTimeout(() => this.disarmUnpublish(), 4000);
            return;
        }
        this.disarmUnpublish();
        btn.disabled = true;
        const doc = await blogStorage.unpublishPost(this.post.id);
        btn.disabled = false;
        if (!doc) {
            window.BlogApp.showToast('Could not unpublish the post', true);
            return;
        }
        state.settings = mergeSettings(state.settings, doc);
        this.post.publishedAt = null;
        this.syncSlugField();
        this.refreshPublishModal();
        refreshPublishMenu();
        window.BlogApp.showToast('Post taken offline');
    },

    copyPostLink() {
        if (!this.post || !this.post.publishedAt) return;
        const url = location.origin + postPublicPath(this.post);
        const done = () => window.BlogApp.showToast('Link copied');
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
        } else {
            fallbackCopy(url, done);
        }
    },

    // ================================================
    // Persistence (model is truth)
    // ================================================

    onTextChange() {
        if (this.suppressChange || !this.post) return;
        this.post.html = this.quill.root.innerHTML;
        this.scheduleSave();
    },

    scheduleSave() {
        this.setIndicator('saving');
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save(), 800);
    },

    async save() {
        if (!this.post) return;
        if (this.saving) {
            this.pendingSave = true;
            return;
        }
        this.saving = true;
        const result = await blogStorage.savePost({
            id: this.post.id,
            title: this.post.title,
            html: this.post.html
        });
        this.saving = false;

        if (!result.success) {
            this.setIndicator('error');
            window.BlogApp.showToast('Save failed — check your connection', true);
            return;
        }
        this.post.updatedAt = new Date().toISOString();
        // The server derives the slug suggestion from the title for
        // never-published posts — mirror it so the modal pre-fills fresh.
        const savedPost = result.data && result.data.posts
            ? result.data.posts.find(p => p && p.id === this.post.id)
            : null;
        if (savedPost && savedPost.slug) this.post.slug = savedPost.slug;
        this.setIndicator('saved');
        if (this.pendingSave) {
            this.pendingSave = false;
            this.save();
        }
    },

    setIndicator(stateName) {
        const el = $('saveIndicator');
        el.dataset.state = stateName;
        el.textContent = stateName === 'saving' ? 'Saving…'
            : stateName === 'error' ? 'Not saved' : 'Saved';
    },

    // ================================================
    // Delete
    // ================================================

    openDeleteModal() {
        if (!this.post) return;
        $('deletePostName').textContent = this.post.title || 'Untitled';
        $('deletePostModal').classList.remove('hidden');
    },

    closeDeleteModal() {
        $('deletePostModal').classList.add('hidden');
    },

    async confirmDelete() {
        const id = this.post && this.post.id;
        if (!id) return;
        const doc = await blogStorage.deletePost(id);
        this.closeDeleteModal();
        if (!doc) {
            window.BlogApp.showToast('Could not delete the post', true);
            return;
        }
        const posts = window.BlogApp.posts;
        const index = posts.findIndex(p => p && p.id === id);
        if (index >= 0) posts.splice(index, 1);
        window.BlogApp.showToast('Post deleted');
        window.BlogApp.showPostsView();
    },

    // ================================================
    // Insert image by URL
    // ================================================

    openImageModal() {
        $('imageUrlInput').value = '';
        $('imageError').classList.add('hidden');
        $('imageModal').classList.remove('hidden');
        $('imageUrlInput').focus();
    },

    closeImageModal() {
        $('imageModal').classList.add('hidden');
        this.quill.focus();
    },

    confirmImage() {
        const url = $('imageUrlInput').value.trim();
        if (!/^https?:\/\//i.test(url)) {
            const error = $('imageError');
            error.textContent = 'Enter an http(s) image URL.';
            error.classList.remove('hidden');
            return;
        }
        const range = this.quill.getSelection(true);
        const index = range ? range.index : this.quill.getLength();
        this.quill.insertEmbed(index, 'image', url);
        this.quill.setSelection(index + 1);
        this.closeImageModal();
        this.post.html = this.quill.root.innerHTML;
        this.scheduleSave();
    }
};

if (typeof window !== 'undefined') {
    window.BlogEditor = BlogEditor;
}
