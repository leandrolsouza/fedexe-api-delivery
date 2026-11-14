import { createServer } from 'node:http';

const large = '{"ok":true,"padding":"' + 'x'.repeat(10 * 1024 * 1024) + '"}';
const users = [
  { id: 1, name: 'Alex Morgan', email: 'alex@acme.dev', role: 'developer', status: 'active' },
  { id: 2, name: 'Sofia Chen', email: 'sofia@acme.dev', role: 'designer', status: 'active' },
  { id: 3, name: 'Lucas Silva', email: 'lucas@acme.dev', role: 'admin', status: 'active' },
];

createServer((request, response) => {
  // This loopback-only fixture intentionally permits browser previews, never production credentials.
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Accept, X-API-Key',
  );
  response.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  );
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  const url = new URL(request.url, 'http://127.0.0.1:8787');
  if (url.pathname === '/users' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 10));
    const filtered = users.filter((user) =>
      user.name.toLowerCase().includes((url.searchParams.get('search') || '').toLowerCase()),
    );
    response.end(
      JSON.stringify({
        success: true,
        data: filtered.slice((page - 1) * limit, page * limit),
        pagination: { page, limit, total: filtered.length },
      }),
    );
  } else if (url.pathname === '/users' && request.method === 'POST') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) request.destroy();
    });
    request.on('end', () => {
      try {
        const value = JSON.parse(body);
        response.statusCode = 201;
        response.end(JSON.stringify({ success: true, data: { ...value, id: 4 }, fixture: true }));
      } catch {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
  } else if (/^\/users\/\d+$/.test(url.pathname)) {
    const user = users.find((user) => user.id === Number(url.pathname.split('/').pop()));
    if (!user) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Usuário não encontrado' }));
    } else if (request.method === 'DELETE') {
      response.statusCode = 204;
      response.end();
    } else if (['PATCH', 'PUT'].includes(request.method)) {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) request.destroy();
      });
      request.on('end', () => {
        try {
          response.end(
            JSON.stringify({
              success: true,
              data: { ...user, ...JSON.parse(body), id: user.id },
              fixture: true,
            }),
          );
        } catch {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: 'JSON inválido' }));
        }
      });
    } else response.end(JSON.stringify({ success: true, data: user }));
  } else if (url.pathname === '/health') {
    response.end(
      JSON.stringify({
        success: true,
        status: 'healthy',
        service: 'Acme API',
        version: '1.0.0',
        fixture: true,
      }),
    );
  } else if (request.url === '/token') {
    response.end('{"token":"local-test"}');
  } else if (request.url === '/large') {
    response.end(large);
  } else if (request.url === '/private') {
    const authorized = request.headers.authorization === 'Bearer local-test';
    response.statusCode = authorized ? 200 : 401;
    response.end(JSON.stringify({ ok: authorized }));
  } else {
    response.statusCode = 404;
    response.end('{}');
  }
}).listen(8787, '127.0.0.1', () => {
  console.log('Servidor de teste em http://127.0.0.1:8787');
});
