// Holm app entrypoint. Private app data is always scoped to the member in
// Holm's verified session cookie; legacy account hashes are never trusted.
import { handleTodo } from './todo.js';
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
          theme: env.holm.app.member.kv.get('workdeck_settings')?.theme || 'dark',
        } : null,
        loginURL: env.holm.auth.getLoginURL('/account'),
        logoutURL: env.holm.auth.getLogoutURL(),
        accountURL: env.holm.auth.getAccountURL('/account'),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found.' }, { status: 404 });
    }
    if (pathname === '/' && env.holm.auth.getMember()) {
      return Response.redirect(new URL('/home', request.url), 302);
    }
    if (pathname === '/home') {
      if (!env.holm.auth.getMember()) return Response.redirect(new URL(env.holm.auth.getLoginURL('/home'), request.url), 302);
      return env.holm.web.fetch(new Request(new URL('/home.html', request.url), request));
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
