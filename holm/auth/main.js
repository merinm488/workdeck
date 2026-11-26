// Holm app entrypoint. Private app data is always scoped to the member in
// Holm's verified session cookie; legacy account hashes are never trusted.
import { handleTodo } from './todo.js';
import { handleProfile, memberProfile } from './profile.js';
import { handleWorkspace } from './workspace.js';
import { handleKanban } from './kanban.js';
import { handleMinutes } from './minutes.js';
import { handleCalendar } from './calendar.js';
import { handleDocs } from './docs.js';
import { handleSheets } from './sheets.js';
import { handleForms } from './forms.js';
import { handleSlides } from './slides.js';
import { handleDraw } from './draw.js';
import { handleFilebox } from './filebox.js';
import { handleBlog, handleSite, publicArticle, validSlug } from './blog.js';
// Holm exports these named handlers to its native, consented /_holm/mcp gateway.
export { workspaceList, workspaceRead, docCreate, docUpdate, todoLists, todoItems,
  todoCreateList, todoAddTask, todoUpdateTask } from './mcp.js';
export { workspaceCreate, workspaceUpdate, todoRenameList, kanbanCreateBoard,
  kanbanAddColumn, kanbanUpsertCard, formCreate, formUpsertQuestion,
  slidesCreateDeck, slidesAddSlide, slidesAddText, drawCreate, drawAddText,
  canvasAddObject, canvasUpdateObject, sheetCreate, sheetReadCells,
  sheetWriteCells, sheetCells, folderCreate, fileUpload, fileRead } from './mcp-extra.js';

// Never reuse session-dependent HTML or redirects after sign-in/sign-out.
function sessionRedirect(path, request) {
  return new Response(null, { status: 302, headers: {
    Location: new URL(path, request.url).href, 'Cache-Control': 'private, no-store', Vary: 'Cookie',
  } });
}
function sessionPage(template, request, env) {
  // These templates must live in api/, not web/: Holm serves static files
  // before this handler, which would bypass both the session gate and redirect.
  return new Response(request.method === 'HEAD' ? null : env.holm.private.read(template), { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store', Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; media-src 'self' blob: https:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'",
  } });
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/todo/')) return handleTodo(request, env);
    if (pathname === '/api/workdeck') return handleWorkspace(request, env);
    if (pathname === '/api/kanban') return handleKanban(request, env);
    if (pathname === '/api/minutes') return handleMinutes(request, env);
    if (pathname === '/api/calendar') return handleCalendar(request, env);
    if (pathname === '/api/docs') return handleDocs(request, env);
    if (pathname === '/api/users') return handleSheets(request, env);
    if (pathname === '/api/forms') return handleForms(request, env);
    if (pathname === '/api/slides') return handleSlides(request, env);
    if (pathname === '/api/draw') return handleDraw(request, env);
    if (pathname === '/api/filebox') return handleFilebox(request, env);
    if (pathname === '/api/blog') return handleBlog(request, env);
    if (pathname === '/api/site') return handleSite(request, env);
    if (pathname === '/api/profile') return handleProfile(request, env);
    if (pathname === '/api/me') {
      if (request.method !== 'GET') {
        return new Response(null, { status: 405, headers: { Allow: 'GET' } });
      }
      const member = env.holm.auth.getMember();
      return Response.json({
        member: member ? {
          id: member.id,
          name: member.name || '',
          email: member.email || '',
          ...memberProfile(member, env.holm.app.member.kv),
          theme: env.holm.app.member.kv.get('workdeck_settings')?.theme || 'dark',
        } : null,
        loginURL: env.holm.auth.getLoginURL('/home'),
        logoutURL: env.holm.auth.getLogoutURL(),
        accountURL: env.holm.auth.getAccountURL('/home'),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found.' }, { status: 404 });
    }
    // Decide before serving HTML so a member can never paint the landing page.
    // Cover static/extensionless aliases too; /apps remains a public catalogue.
    if (['/', '/index', '/index.html'].includes(pathname)) {
      if (env.holm.auth.getMember()) return sessionRedirect('/home', request);
      return sessionPage('landing.html', request, env);
    }
    if (pathname === '/account') return sessionRedirect('/home', request);
    if (['/home', '/home/', '/home.html'].includes(pathname)) {
      if (!env.holm.auth.getMember()) return sessionRedirect('/', request);
      if (pathname !== '/home') return sessionRedirect('/home', request);
      return sessionPage('home.html', request, env);
    }
    if (pathname.startsWith('/files/') && pathname !== '/files/' && !pathname.includes('.', 7)) {
      return env.holm.web.fetch(new Request(new URL('/files/index.html', request.url), request));
    }
    if (pathname.startsWith('/draw/') && pathname !== '/draw/' && pathname !== '/draw/shared' && !pathname.includes('.', 6)) {
      return env.holm.web.fetch(new Request(new URL('/draw/editor.html', request.url), request));
    }
    if (pathname.startsWith('/slides/') && pathname !== '/slides/' && pathname !== '/slides/shared' && !pathname.includes('.', 8)) {
      return env.holm.web.fetch(new Request(new URL('/slides/editor.html', request.url), request));
    }
    if (pathname.startsWith('/forms/') && pathname !== '/forms/' && pathname !== '/forms/shared' && !pathname.includes('.', 7)) {
      return env.holm.web.fetch(new Request(new URL('/forms/editor.html', request.url), request));
    }
    if (pathname.startsWith('/sheets/') && pathname !== '/sheets/' && pathname !== '/sheets/shared' && !pathname.includes('.', 8)) {
      return env.holm.web.fetch(new Request(new URL('/sheets/editor.html', request.url), request));
    }
    if (pathname.startsWith('/calendar/') && pathname !== '/calendar/' && !pathname.includes('.', 10)) {
      return env.holm.web.fetch(new Request(new URL('/calendar/index.html', request.url), request));
    }
    if (pathname.startsWith('/minutes/') && pathname !== '/minutes/' && !pathname.includes('.', 9)) {
      return env.holm.web.fetch(new Request(new URL('/minutes/index.html', request.url), request));
    }
    if (pathname.startsWith('/kanban/') && pathname !== '/kanban/' && !pathname.includes('.', 8)) {
      return env.holm.web.fetch(new Request(new URL('/kanban/index.html', request.url), request));
    }
    if (pathname.startsWith('/todo/') && pathname !== '/todo/' && !pathname.includes('.', 6)) {
      // Serve the same Todo shell for a direct visit to /todo/<list-id>.
      return env.holm.web.fetch(new Request(new URL('/todo/index.html', request.url), request));
    }
    if (pathname.startsWith('/blog/') && pathname !== '/blog/' && !pathname.includes('.', 6)) {
      return env.holm.web.fetch(new Request(new URL('/blog/index.html', request.url), request));
    }
    const slug = /^\/([a-z0-9-]{3,40})\/?$/.exec(pathname)?.[1];
    if (slug && validSlug(slug) && request.method === 'GET' && publicArticle(env, slug)) {
      // Internal static fetch, not a redirect: keep /<slug> in the address
      // bar so the existing public reader can resolve the article on reload.
      return env.holm.web.fetch(new Request(new URL('/blog-public', request.url), request));
    }
    return env.holm.web.fetch(request);
  },
};
