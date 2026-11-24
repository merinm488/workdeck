/**
 * ================================================
 * FILEBOX - ESM Vendor Bridge
 * ================================================
 *
 * pdf.js and PhotoSwipe ship ESM-only builds, so they are imported here
 * and published on window for the classic scripts (uploads.js, viewer.js).
 */

import * as pdfjsLib from '/files/js/pdf.min.mjs';
import PhotoSwipe from 'https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.esm.min.js';

pdfjsLib.GlobalWorkerOptions.workerSrc =
    '/files/js/pdf.worker.min.mjs';

window.pdfjsLib = pdfjsLib;
window.PhotoSwipe = PhotoSwipe;