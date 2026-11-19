// Holm-only identity endpoint and private Todo pilot. Never use the legacy
// access-key hash: the member scope is derived from Holm's session cookie.
import { handleTodo } from './todo.js';

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/todo/')) return handleTodo(request, env);
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
        } : null,
        loginURL: env.holm.auth.getLoginURL('/account'),
        logoutURL: env.holm.auth.getLogoutURL(),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found.' }, { status: 404 });
    }
    if (pathname.startsWith('/todo/') && pathname !== '/todo/' && !pathname.includes('.', 6)) {
      // Serve the same Todo shell for a direct visit to /todo/<list-id>.
      return env.holm.web.fetch(new Request(new URL('/todo/index.html', request.url), request));
    }
    return env.holm.web.fetch(request);
  },
};
