import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancel, runCollection, send } from './transport';
import type { NativeCollection } from './models';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/token') response.end('{"token":"test-session"}');
    else if (request.url === '/private') {
      response.statusCode = request.headers.authorization === 'Bearer test-session' ? 200 : 401;
      response.end('{"ok":true}');
    } else if (request.url === '/large')
      response.end(JSON.stringify({ padding: 'x'.repeat(300 * 1024) }));
    else if (request.url === '/slow') {
      const timer = setTimeout(() => response.end('{}'), 2000);
      response.on('close', () => clearTimeout(timer));
    } else if (request.url === '/oversize') {
      response.end(JSON.stringify({ padding: 'x'.repeat(17 * 1024 * 1024) }));
    } else if (request.url === '/disconnect') {
      request.socket.destroy();
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : ''}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('adaptador HTTP para prévia no navegador', () => {
  it('retorna respostas reais com status, duração e headers', async () => {
    const response = await send({ method: 'GET', url: `${base}/token`, headers: {}, body: null });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.preview)).toEqual({ token: 'test-session' });
    expect(response.headers.some(([key]) => key === 'content-type')).toBe(true);
  });
  it('limita a prévia a 256 KiB sem guardar o corpo completo', async () => {
    const response = await send({ method: 'GET', url: `${base}/large`, headers: {}, body: null });
    expect(response.truncated).toBe(true);
    expect(new TextEncoder().encode(response.preview).length).toBe(256 * 1024);
  });
  it('executa em sequência, extrai tokens e isola as variáveis entre rodadas', async () => {
    const collection: NativeCollection = {
      variables: { base },
      requests: [
        {
          name: 'Token',
          request: { method: 'GET', url: '{{base}}/token', headers: {}, body: null },
          tests: [{ type: 'status', equals: 200 }],
          extract: { token: '/token' },
        },
        {
          name: 'Autenticada',
          request: {
            method: 'GET',
            url: '{{base}}/private',
            headers: { Authorization: 'Bearer {{token}}' },
            body: null,
          },
          tests: [
            { type: 'status', equals: 200 },
            { type: 'header', name: 'Content-Type' },
            { type: 'header', name: 'CONTENT-TYPE', equals: 'application/json' },
            { type: 'json', pointer: '/ok', equals: true },
          ],
          extract: {},
        },
      ],
    };
    const progress: string[] = [];
    const result = await runCollection(collection, ({ type, index }) =>
      progress.push(`${type}:${index}`),
    );
    expect(result.results.map((row) => row.status)).toEqual([200, 200]);
    expect(result.results[1].checks_passed).toBe(4);
    expect(progress).toEqual(['started:0', 'finished:0', 'started:1', 'finished:1']);
    expect(collection.variables).toEqual({ base });
    const isolated = await runCollection(
      { ...collection, requests: collection.requests.slice(1) },
      () => {},
    );
    expect(isolated.results[0].failures[0]).toContain('Variável ausente');
  });
  it('continua após falhas e preserva os diagnósticos', async () => {
    const result = await runCollection(
      {
        variables: {},
        requests: [
          {
            name: 'Falha intencional',
            request: { method: 'GET', url: `${base}/missing`, headers: {}, body: null },
            tests: [{ type: 'status', equals: 200 }],
            extract: {},
          },
          {
            name: 'Sucesso',
            request: { method: 'GET', url: `${base}/token`, headers: {}, body: null },
            tests: [{ type: 'status', equals: 200 }],
            extract: {},
          },
        ],
      },
      () => {},
    );
    expect(result.results[0].failures[0]).toContain('recebido 404');
    expect(result.results[1].failures).toEqual([]);
  });
  it('cancela uma requisição em andamento', async () => {
    const pending = send({ method: 'GET', url: `${base}/slow`, headers: {}, body: null });
    await cancel();
    await expect(pending).rejects.toThrow('cancelada');
  });
  it('diagnostica rede, variável e limite JSON sem interromper as etapas seguintes', async () => {
    const makeStep = (url: string): NativeCollection['requests'][number] => ({
      name: url,
      request: { method: 'GET', url, headers: {}, body: null },
      tests: [{ type: 'status', equals: 200 }],
      extract: {},
    });
    const json = makeStep(base + '/oversize');
    json.tests.push({ type: 'json', pointer: '/padding', equals: 'x' });
    const { results, outcome } = await runCollection(
      {
        variables: {},
        requests: [
          makeStep(base + '/disconnect'),
          makeStep('{{missing}}/token'),
          makeStep(base + '/oversize'),
          json,
          makeStep(base + '/token'),
        ],
      },
      () => {},
    );
    expect(outcome).toBe('completed');
    expect(results.map(({ status }) => status)).toEqual([null, null, 200, 200, 200]);
    expect(results[0].failures).toHaveLength(1);
    expect(results[1].failures[0]).toContain('Variável ausente');
    expect(results[2].failures).toEqual([]);
    expect(results[3].checks_passed).toBe(1);
    expect(results[3].failures[0]).toContain('limite de validação JSON');
    expect(results[4].failures).toEqual([]);
  });
});
