// Holm-only identity endpoint. Never use the legacy access-key hash to
// identify users: member.id is supplied by Holm's verified session cookie.
export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
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
    return env.holm.web.fetch(request);
  },
};
