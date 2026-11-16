import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancel, runCollection, send } from './transport';
import type { NativeCollection } from './models';
import { importPostman } from './postman';
import { prepareCollection } from './collection-runner';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/token') response.end('{"token":"test-session"}');
    else if (request.url === '/m2m') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => (body += chunk));
      request.on('end', () => {
        const ok =
          request.method === 'POST' &&
          request.headers['content-type'] === 'application/json' &&
          body === '{"clientId":"fixture-id","clientSecret":"fixture-secret"}';
        response.statusCode = ok ? 200 : 400;
        response.end(ok ? '{"access_token":"test-session"}' : '{}');
      });
    } else if (request.url === '/private') {
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
    expect(isolated.results[0].failures[0]).toContain('Missing variable');
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
    expect(result.results[0].failures[0]).toContain('received 404');
    expect(result.results[0].failure_reasons).toEqual(['status']);
    expect(result.results[1].failures).toEqual([]);
  });
  it('reinicia extrações por iteração e aplica o intervalo entre rodadas', async () => {
    const collection: NativeCollection = {
      variables: { token: 'initial' },
      iterations: 2,
      delay_ms: 25,
      requests: [
        {
          name: 'Antes da extração',
          request: {
            method: 'GET',
            url: `${base}/private`,
            headers: { Authorization: 'Bearer {{token}}' },
            body: null,
          },
          tests: [{ type: 'status', equals: 401 }],
          extract: {},
        },
        {
          name: 'Extrai token',
          request: { method: 'GET', url: `${base}/token`, headers: {}, body: null },
          tests: [],
          extract: { token: '/token' },
        },
      ],
    };
    const progress: number[] = [];
    let previousFinish = 0;
    const intervals: number[] = [];
    const result = await runCollection(collection, (event) => {
      if (event.type === 'finished') previousFinish = performance.now();
      else {
        progress.push(event.index);
        if (event.index > 0) intervals.push(performance.now() - previousFinish);
      }
    });
    expect(progress).toEqual([0, 1, 2, 3]);
    expect(result.results.map((row) => row.status)).toEqual([401, 200, 401, 200]);
    expect(result.results.flatMap((row) => row.failures)).toEqual([]);
    intervals.forEach((interval) => expect(interval).toBeGreaterThanOrEqual(20));
  });
  it('cancela durante o intervalo e mantém a etapa concluída', async () => {
    const result = await runCollection(
      {
        variables: {},
        iterations: 2,
        delay_ms: 60000,
        requests: [
          {
            name: 'Token',
            request: { method: 'GET', url: `${base}/token`, headers: {}, body: null },
            tests: [],
            extract: {},
          },
        ],
      },
      (event) => {
        if (event.type === 'finished' && event.index === 0) setTimeout(() => void cancel(), 10);
      },
    );
    expect(result.outcome).toBe('cancelled');
    expect(result.results.map((row) => row.status)).toEqual([200]);
  });
  it('cancela uma requisição em andamento', async () => {
    const pending = send({ method: 'GET', url: `${base}/slow`, headers: {}, body: null });
    await cancel();
    await expect(pending).rejects.toThrow('canceled');
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
    expect(results[1].failures[0]).toContain('Missing variable');
    expect(results[2].failures).toEqual([]);
    expect(results[3].checks_passed).toBe(1);
    expect(results[3].failures[0]).toContain('JSON validation limit');
    expect(results.map(({ failure_reasons }) => failure_reasons)).toEqual([
      ['transport'],
      ['preparation'],
      [],
      ['json'],
      [],
    ]);
    expect(results[4].failures).toEqual([]);
  });
});

describe('runner com scripts', () => {
  it('aguarda o callback de pm.sendRequest antes de enviar a etapa protegida', async () => {
    const { collection } = importPostman({
      info: {
        name: 'M2M',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      event: [
        {
          listen: 'prerequest',
          script: {
            exec: `
          if (pm.environment.name !== "Fixture") throw new Error("Wrong environment");
          ["environment", "globals"].forEach(scope => pm[scope].get("token"));
          console.log("Requesting token");
          const clientId = atob("Zml4dHVyZS1pZA==");
          pm.sendRequest({
            url: "{{base}}/m2m",
            method: "POST",
            header: { "Content-Type": "application/json" },
            body: { mode: "raw", raw: JSON.stringify({ clientId, clientSecret: "{{secret}}" }) }
          }, (error, response) => {
            if (error) throw error;
            if (response.code !== 200) throw new Error("Token denied");
            pm.collectionVariables.set("token", response.json().access_token);
          });
        `,
          },
        },
      ],
      item: [
        {
          name: 'Privada',
          request: {
            url: '{{base}}/private',
            header: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
          },
        },
      ],
    })!;
    const environment = {
      id: 'fixture',
      name: 'Fixture',
      color: '',
      variables: [
        { id: 'base', key: 'base', value: base, enabled: true },
        { id: 'secret', key: 'secret', value: 'fixture-secret', enabled: true, secret: true },
      ],
    };
    const requests = collection!.requests;
    const run = await runCollection(
      prepareCollection(collection!, environment, requests, true),
      () => {},
      [],
      {
        collection: collection!,
        environment,
        requests,
      },
    );
    expect(run.results.map(({ status, failures }) => ({ status, failures }))).toEqual([
      { status: 200, failures: [] },
    ]);
    expect(environment.variables.some(({ key }) => key === 'token')).toBe(false);
  });

  it('executa na ordem, encadeia variáveis e para em uma falha de script', async () => {
    const event = (listen: string, exec: string) => ({ listen, script: { exec } });
    const { collection } = importPostman({
      info: {
        name: 'Scripts',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      event: [
        event('prerequest', 'pm.variables.set("phase", "before");'),
        event(
          'test',
          'if (pm.response.json().token) pm.collectionVariables.set("token", pm.response.json().token);',
        ),
      ],
      item: [
        {
          name: 'Login',
          request: base + '/token',
          event: [
            event(
              'prerequest',
              'pm.test("pré", () => pm.expect(pm.environment.get("phase")).to.equal("before"));',
            ),
            event('test', "pm.test('Status 200', () => pm.response.to.have.status(200));"),
          ],
        },
        {
          name: 'Privada',
          request: base + '/private',
          event: [
            event(
              'prerequest',
              'pm.request.headers.upsert({ key: "Authorization", value: "Bearer " + pm.collectionVariables.get("token") });',
            ),
            event('test', 'pm.test("privada", () => pm.response.to.have.status(200));'),
          ],
        },
        {
          name: 'Falha antes do envio',
          request: base + '/private',
          event: [event('prerequest', 'throw new Error("Interrompida");')],
        },
        { name: 'Ignorada', request: base + '/token' },
      ],
    })!;
    const requests = collection!.requests;
    const environment = { id: 'dev', name: 'Dev', variables: [], color: '' };
    const run = await runCollection(
      prepareCollection(collection!, environment, requests, true),
      () => {},
      [],
      {
        collection: collection!,
        environment,
        requests,
      },
    );
    expect(run.outcome).toBe('stopped_on_failure');
    expect(run.results.map((row) => row.status)).toEqual([200, 200, null]);
    expect(run.results.map((row) => row.checks_passed)).toEqual([2, 1, 0]);
    expect(run.results[2].failures).toEqual([expect.stringContaining('Interrompida')]);
    expect(run.results[2].failure_reasons).toEqual(['script']);
    expect(environment.variables).toEqual([]);
  });
});
