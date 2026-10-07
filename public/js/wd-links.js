/**
 * ================================================
 * WORKDECK - Hard Links (WDLinks)
 * ================================================
 *
 * Single source of truth for addressing a Workdeck file by URL. Every file
 * has a canonical, pasteable address:
 *
 *   /docs/<id>   /sheets/<id>   /forms/<id>   /slides/<id>   /draw/<id>
 *   /filebox/<id>                (folders stay query-based: /filebox/?folder=<id>)
 *   /f/<id>                      universal resolver -> canonical address
 *
 */

(function () {
    'use strict';
    var ID_SOURCE = '[a-z0-9]{14,}';
    var ID_RE = new RegExp('^' + ID_SOURCE + '$');

    /** Internal link hrefs -> { app, id, query }. Used to detect mentions. */
    var INTERNAL_LINK_RE = new RegExp(
        '^/(docs|sheets|forms|slides|draw|filebox)/(' + ID_SOURCE + ')(\\?[^#]*)?(#.*)?$'
    );

    /**
     * App registry — mirrors WD_APPS in public/js/workdeck.js. `page` is the
     * document the server rewrite targets; `param` is the query parameter the
     * app reads its id from; `prefix` is the pretty path root.
     */
    var APPS = {
        docs: {
            id: 'docs', name: 'Docs', label: 'Doc',
            page: '/docs/', param: 'doc', prefix: '/docs/'
        },
        sheets: {
            id: 'sheets', name: 'Sheets', label: 'Sheet',
            page: '/sheets/editor.html', param: 'id', prefix: '/sheets/'
        },
        forms: {
            id: 'forms', name: 'Forms', label: 'Form',
            page: '/forms/editor.html', param: 'id', prefix: '/forms/'
        },
        slides: {
            id: 'slides', name: 'Slides', label: 'Slide',
            page: '/slides/editor.html', param: 'id', prefix: '/slides/'
        },
        draw: {
            id: 'draw', name: 'Draw', label: 'Drawing',
            page: '/draw/editor.html', param: 'id', prefix: '/draw/'
        },
        filebox: {
            id: 'filebox', name: 'Files', label: 'File',
            page: '/filebox/', param: 'id', prefix: '/filebox/'
        }
    };

    /** Minimal stroke icons (24px grid) for chips/pickers. Kept independent
     *  from the launcher's WD_APPS so every page renders the same art.
     *  Each icon is a [tag, attrs] element list. */
    var ICONS = {
        docs: [
            ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
            ['polyline', { points: '14 2 14 8 20 8' }],
            ['line', { x1: 16, y1: 13, x2: 8, y2: 13 }],
            ['line', { x1: 16, y1: 17, x2: 8, y2: 17 }]
        ],
        sheets: [
            ['path', { d: 'M3 10h18M3 14h18m-9-4v8m-7-6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a2 2 0 012-2z' }]
        ],
        forms: [
            ['path', { d: 'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z' }],
            ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }],
            ['line', { x1: 9, y1: 12, x2: 15, y2: 12 }],
            ['line', { x1: 9, y1: 16, x2: 13, y2: 16 }]
        ],
        slides: [
            ['rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }],
            ['line', { x1: 12, y1: 17, x2: 12, y2: 21 }],
            ['line', { x1: 8, y1: 21, x2: 16, y2: 21 }]
        ],
        draw: [
            ['path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }],
            ['path', { d: 'm15 5 4 4' }]
        ],
        filebox: [
            ['path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' }]
        ]
    };

    var SVG_NS = 'http://www.w3.org/2000/svg';

    function iconParts(appId) {
        return ICONS[appId] || ICONS.filebox;
    }

    function setIconAttrs(el, attrs) {
        for (var name in attrs) el.setAttribute(name, attrs[name]);
    }

    /** Icon as an <svg> element. */
    function iconNode(appId, size) {
        var s = size || 16;
        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', s);
        svg.setAttribute('height', s);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        iconParts(appId).forEach(function (part) {
            var el = document.createElementNS(SVG_NS, part[0]);
            setIconAttrs(el, part[1]);
            svg.appendChild(el);
        });
        return svg;
    }

    /** Icon as SVG markup. The docs app embeds this string directly. */
    function icon(appId, size) {
        var s = size || 16;
        var body = iconParts(appId).map(function (part) {
            var attrs = Object.keys(part[1]).map(function (name) {
                return ' ' + name + '="' + part[1][name] + '"';
            }).join('');
            return '<' + part[0] + attrs + '/>';
        }).join('');
        return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" '
            + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + body + '</svg>';
    }

    function isValidId(id) {
        return typeof id === 'string' && ID_RE.test(id);
    }

    /**
     * Canonical URL for a file.
     *   WDLinks.url('sheets', id)                     -> '/sheets/<id>'
     *   WDLinks.url('docs', id, { edit: true })       -> '/docs/<id>?edit=1'
     *   WDLinks.url('forms', id, { fill: true })      -> '/forms/<id>?fill=1'
     *   WDLinks.url('filebox', id, { folder: true })  -> '/filebox/?folder=<id>'
     */
    function url(appId, id, opts) {
        opts = opts || {};
        var app = APPS[appId] || APPS.filebox;
        if (opts.folder) {
            return '/filebox/?folder=' + encodeURIComponent(id);
        }
        var qs = [];
        if (opts.edit) qs.push('edit=1');
        if (opts.fill) qs.push('fill=1');
        return app.prefix + encodeURIComponent(id) + (qs.length ? '?' + qs.join('&') : '');
    }


    function parseLocation() {
        return parsePath(window.location.pathname + window.location.search);
    }

    /** Parse a path (+ optional query) into { app, id, kind?, query? }. */
    function parsePath(pathAndQuery) {
        var path = String(pathAndQuery || '');
        var qIndex = path.indexOf('?');
        var query = qIndex === -1 ? '' : path.slice(qIndex + 1);
        var pathname = qIndex === -1 ? path : path.slice(0, qIndex);
        var params = new URLSearchParams(query);

        // Pretty path: /<app>/<id>
        var pretty = new RegExp(
            '^/(docs|sheets|forms|slides|draw|filebox)/(' + ID_SOURCE + ')/?$'
        ).exec(pathname);
        if (pretty) {
            return { app: pretty[1], id: pretty[2], query: query };
        }

        // Universal resolver: /f/<id> (f.html redirects to the canonical app)
        var resolver = new RegExp('^/f/(' + ID_SOURCE + ')/?$').exec(pathname);
        if (resolver) {
            return { app: 'resolver', id: resolver[1], query: query };
        }

        // Legacy query form — infer the app from the path prefix.
        var prefix = new RegExp('^/(docs|sheets|forms|slides|draw|filebox)(/|$)').exec(pathname);
        if (prefix) {
            var app = prefix[1];
            if (app === 'docs' && params.get('doc') && isValidId(params.get('doc'))) {
                return { app: 'docs', id: params.get('doc'), query: query };
            }
            if (app === 'filebox' && params.get('folder') && isValidId(params.get('folder'))) {
                return { app: 'filebox', id: params.get('folder'), kind: 'folder', query: query };
            }
            if (app !== 'docs' && params.get('id') && isValidId(params.get('id'))) {
                return { app: app, id: params.get('id'), query: query };
            }
        }
        return null;
    }

    /** Is this href an internal hard link? -> { app, id, query } | null.
     *  Accepts absolute URLs, site-absolute paths and hash-less relatives. */
    function parseHref(href) {
        if (!href) return null;
        var path = href;
        try {
            if (/^(https?:)?\/\//i.test(href) || href.charAt(0) !== '/') {
                var u = new URL(href, window.location.origin);
                if (u.origin !== window.location.origin) return null;
                path = u.pathname + u.search;
            }
        } catch (err) {
            return null;
        }
        return parsePath(path);
    }

    /**
     * Find a file anywhere in the unified user document.
     */
    function resolve(id, userData) {
        if (!userData || !isValidId(id)) return null;

        var docs = userData.docs || [];
        for (var i = 0; i < docs.length; i++) {
            if (docs[i] && docs[i].id === id) {
                return { app: 'docs', id: id, name: docs[i].title || 'Untitled',
                    kind: 'file', record: docs[i], url: url('docs', id) };
            }
        }
        var sheets = userData.sheets || [];
        for (var j = 0; j < sheets.length; j++) {
            if (sheets[j] && sheets[j].id === id) {
                return { app: 'sheets', id: id, name: sheets[j].name || 'Untitled Sheet',
                    kind: 'file', record: sheets[j], url: url('sheets', id) };
            }
        }
        var forms = userData.forms || [];
        for (var k = 0; k < forms.length; k++) {
            if (forms[k] && forms[k].id === id) {
                return { app: 'forms', id: id, name: forms[k].name || 'Untitled Form',
                    kind: 'file', record: forms[k], url: url('forms', id) };
            }
        }
        var slides = userData.slides || [];
        for (var l = 0; l < slides.length; l++) {
            if (slides[l] && slides[l].id === id) {
                return { app: 'slides', id: id, name: slides[l].name || 'Untitled Deck',
                    kind: 'file', record: slides[l], url: url('slides', id) };
            }
        }
        var draws = userData.draws || [];
        for (var m = 0; m < draws.length; m++) {
            if (draws[m] && draws[m].id === id) {
                return { app: 'draw', id: id, name: draws[m].name || 'Untitled Drawing',
                    kind: 'file', record: draws[m], url: url('draw', id) };
            }
        }
        var files = userData.files || [];
        for (var n = 0; n < files.length; n++) {
            if (files[n] && files[n].id === id) {
                return { app: 'filebox', id: id, name: files[n].name || 'Untitled File',
                    kind: 'file', record: files[n], url: url('filebox', id) };
            }
        }
        var folders = userData.folders || [];
        for (var o = 0; o < folders.length; o++) {
            if (folders[o] && folders[o].id === id) {
                return { app: 'filebox', id: id, name: folders[o].name || 'Folder',
                    kind: 'folder', record: folders[o], url: url('filebox', id, { folder: true }) };
            }
        }
        return null;
    }

    /** Session hash: Workdeck's key first, then any app mirror. */
    function sessionHash() {
        var KEYS = ['wd_hash', 'docs_hash', 'sheets_user_hash', 'forms_user_hash',
            'slides_user_hash', 'draw_user_hash', 'filebox_user_hash'];
        for (var i = 0; i < KEYS.length; i++) {
            var v = sessionStorage.getItem(KEYS[i]) || localStorage.getItem(KEYS[i]);
            if (v) return v;
        }
        return null;
    }

    function recordOpen(appId, fileId) {
        var hash = sessionHash();
        if (!hash || !APPS[appId]) return;
        try {
            fetch('/api/workdeck', {
                method: 'PUT',
                keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hash: hash,
                    action: 'recordOpen',
                    data: { fileId: fileId, app: appId }
                })
            }).catch(function () { /* recency is optional */ });
        } catch (err) { /* ignore */ }
    }

    /**
     * Navigate to a file. 
     */
    function open(appId, fileId, opts) {
        opts = opts || {};
        var target = url(appId, fileId, opts);
        recordOpen(appId, fileId);
        if (opts.newTab) {
            window.open(target, '_blank');
        } else {
            window.location.assign(target);
        }
    }

    window.WDLinks = {
        ID_SOURCE: ID_SOURCE,
        ID_RE: ID_RE,
        INTERNAL_LINK_RE: INTERNAL_LINK_RE,
        APPS: APPS,
        icon: icon,
        iconNode: iconNode,
        url: url,
        parseLocation: parseLocation,
        parsePath: parsePath,
        parseHref: parseHref,
        resolve: resolve,
        sessionHash: sessionHash,
        recordOpen: recordOpen,
        open: open
    };
})();