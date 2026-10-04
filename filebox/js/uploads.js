/**
 * ================================================
 * FILEBOX - Uploads (Uppy)
 * ================================================
 *
 * fileboxUploads — the upload pipeline, built on Uppy's Dashboard widget.
 *
 * Uppy owns the picker, the drag-and-drop surface, the multi-file queue, 
 * per-file progress, retry/cancel, and oversize rejection (restrictions.maxFileSize).
 *
 *
 * Thumbnails ride along on the upload: images are downscaled with
 * browser-image-compression, PDF first pages are rasterised with pdf.js.
 * Both become a small JPEG data URL (api/filebox.js caps it at 60 KB
 * and nulls anything bigger — a thumbnail never fails an upload).
 */

// ================================================
// Encoding / thumbnail helpers
// ================================================

function blobToBase64(blob, withPrefix) {
    return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onerror = function () { reject(new Error('Could not read file')); };
        reader.onload = function () {
            const dataUrl = String(reader.result || '');
            resolve(withPrefix ? dataUrl : dataUrl.slice(dataUrl.indexOf(',') + 1));
        };
        reader.readAsDataURL(blob);
    });
}

/**
 * Small JPEG data URL for image/PDF cards. Returns null for anything
 * else (or on any failure) — previews are best-effort.
 */
async function makeThumbnail(file) {
    const type = file.type || '';
    try {
        if (/^image\//.test(type) && type !== 'image/gif' && type !== 'image/svg+xml') {
            const blob = await imageCompression(file.data, {
                maxWidthOrHeight: 480,
                initialQuality: 0.72,
                fileType: 'image/jpeg'
            });
            const url = await blobToBase64(blob, true);
            return url.length <= 60000 ? url : null;
        }
        if (type === 'application/pdf' && window.pdfjsLib) {
            const buffer = await file.data.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
            const page = await pdf.getPage(1);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(480 / base.width, 2) });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            const url = canvas.toDataURL('image/jpeg', 0.72);
            pdf.destroy();
            return url.length <= 60000 ? url : null;
        }
    } catch (err) {
        return null;   // never fail an upload over a preview
    }
    return null;
}

// ================================================
// Custom uploader (base64 JSON to /api/filebox)
// ================================================

class FileboxJsonUploader extends Uppy.BasePlugin {
    constructor(uppy, opts) {
        super(uppy, opts);
        this.id = 'FileboxJsonUploader';
        this.type = 'uploader';
        this._uploadFn = this.upload.bind(this);
    }

    install() {
        this.uppy.addUploader(this._uploadFn);
    }

    uninstall() {
        this.uppy.removeUploader(this._uploadFn);
    }

    async upload(fileIDs) {
        for (const fileID of fileIDs) {
            await this.uploadOne(fileID);
        }
    }

    async uploadOne(fileID) {
        const file = this.uppy.getFile(fileID);
        if (!file) return;

        this.uppy.emit('upload-start', [file]);   // array — core stamps uploadStarted from this
        this.uppy.emit('upload-progress', file, {
            uploader: this,
            bytesUploaded: 0,
            bytesTotal: file.size || 0
        });

        try {
            const thumbnail = await makeThumbnail(file);
            const base64 = await blobToBase64(file.data, false);
            const response = await fetch(this.opts.endpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash: getFileboxUserHash(),
                    action: 'uploadFile',
                    data: {
                        name: file.name,
                        mime: file.type || 'application/octet-stream',
                        base64: base64,
                        folderId: this.opts.currentFolderId() || null,
                        tags: [],
                        thumbnail: thumbnail
                    }
                })
            });
            const result = await response.json().catch(function () { return {}; });

            const overCap = response.status === 413 || result.error === 'FILE_TOO_LARGE';
            if (!response.ok || !result.success) {
                throw new Error(overCap
                    ? 'Over the ' + Math.round(APP_CONFIG.maxFileSize / 1024) + ' KB limit'
                    : result.error || 'Upload failed (' + response.status + ')');
            }

            this.uppy.emit('upload-success', file, { status: response.status, body: result });
            if (this.opts.onFileUploaded) this.opts.onFileUploaded(result.file);
        } catch (err) {
            this.uppy.emit('upload-error', file, err);
        }
    }
}

// ================================================
// Controller
// ================================================

class FileboxUploads {
    constructor() {
        this.uppy = null;
        this.dashboard = null;
        this.opts = null;
        this.disabled = false;
        this.busy = false;
    }

    /**
     * @param {object} opts - { theme(), currentFolderId(), notify(),
     *                          onFileUploaded(record), onComplete(result) }
     */
    init(opts) {
        this.opts = opts;

        if (!window.Uppy) {
            this.disabled = true;
            console.warn('[UPLOADS] Uppy failed to load from the CDN — uploads are disabled');
            return;
        }

        this.uppy = new window.Uppy.Uppy({
            autoProceed: true,
            restrictions: { maxFileSize: APP_CONFIG.maxFileSize }
        });

        this.uppy.use(window.Uppy.Dashboard, {
            trigger: '#fbUploadBtn',
            inline: false,
            showProgressDetails: true,
            proudlyDisplayPoweredByUppy: false,
            closeModalOnClickOutside: true,
            theme: this.mapTheme(opts.theme())
        });
        // use() returns the Uppy instance in v4 — the plugin comes from getPlugin().
        this.dashboard = this.uppy.getPlugin('Dashboard');

        this.uppy.use(FileboxJsonUploader, {
            endpoint: APP_CONFIG.apiEndpoint,
            currentFolderId: opts.currentFolderId,
            onFileUploaded: opts.onFileUploaded
        });

        this.uppy.on('upload', function () { this.busy = true; }.bind(this));
        this.uppy.on('complete', function (result) {
            this.busy = false;
            opts.onComplete(result);
        }.bind(this));
    }

    /** Feed files in from the window-wide drop overlay. */
    addFiles(fileList) {
        if (this.disabled) {
            if (this.opts) this.opts.notify('Uploads are unavailable right now', 'error');
            return;
        }
        const files = Array.from(fileList || []);
        if (!files.length) return;

        files.forEach(function (file) {
            try {
                this.uppy.addFile({ name: file.name, type: file.type, data: file, source: 'drop' });
            } catch (err) {
                // Restriction failures throw; Dashboard only annotates files
                // added through its own picker, so drops get the toast.
                this.opts.notify(file.name + ': ' + (err.message || 'rejected'), 'error');
            }
        }.bind(this));
        this.openPicker();
    }

    openPicker() {
        if (this.dashboard) this.dashboard.openModal();
    }

    isBusy() {
        return this.busy;
    }

    /** Keep the Dashboard in step with the app theme. */
    applyTheme(preference) {
        if (this.dashboard) this.dashboard.setOptions({ theme: this.mapTheme(preference) });
    }

    mapTheme(preference) {
        return preference === 'dark' ? 'dark' : preference === 'system' ? 'auto' : 'light';
    }
}

// ================================================
// Export
// ================================================

const fileboxUploads = new FileboxUploads();

if (typeof window !== 'undefined') {
    window.FileboxUploads = FileboxUploads;
    window.fileboxUploads = fileboxUploads;
}