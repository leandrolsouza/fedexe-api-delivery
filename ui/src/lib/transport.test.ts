import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancel, runCollection, send } from './transport';
import { hasRunScripts, importCollection, type NativeCollection } from './models';
import { importPostman } from './postman';
import { prepareCollection } from './collection-runner';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/token') response.end('{"token":"test-session"}');
    else if (request.url === '/prospect') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => (body += chunk));
      request.on('end', () => response.end(body));
    } else if (request.url === '/m2m') {
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
  it('executa o pré-script de pasta do F37 com o nome da requisição e aproveita as variáveis', async () => {
    const event = (listen: string, exec: string) => ({ listen, script: { exec } });
    const before = (exec: string) => event('prerequest', exec);
    const imported = importPostman({
      info: {
        name: 'F37',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      variable: [{ key: 'f37_anterior', value: 'antigo' }],
      event: [before('pm.collectionVariables.set("ordem", "coleção");')],
      item: [
        {
          name: '00a',
          event: [
            before(`
              const passo = pm.info.requestName.split('-')[1];
              if (passo !== '01') throw new Error('Pré-script executado fora de 00a');
              Object.keys(pm.collectionVariables.toObject())
                .filter((key) => key.startsWith('f37_'))
                .forEach((key) => pm.collectionVariables.unset(key));
              const email = 'f37-' + passo + '@example.test';
              const celular = '11900000001';
              pm.collectionVariables.set('f37_prospect_a_body', JSON.stringify({ email, celular }));
              pm.collectionVariables.set('f37_uuid_ausente', pm.variables.replaceIn('{{$guid}}'));
              pm.collectionVariables.set('f37_email_a', email);
              pm.collectionVariables.set('f37_celular_a', celular);
              pm.collectionVariables.set('ordem', pm.collectionVariables.get('ordem') + '/00a');
            `),
            before(`
              const passo = pm.info.requestName.split('-')[1];
              if (passo === '01') pm.collectionVariables.set('ordem', pm.collectionVariables.get('ordem') + '/00a-2');
            `),
            event(
              'test',
              `
              pm.test('Resposta JSON válida', () => { pm.response.to.be.json; });
              pm.collectionVariables.set('f37_prospect_a', pm.response.json().email);
            `,
            ),
          ],
          item: [
            {
              name: 'Prospects',
              event: [
                before(`
                  pm.collectionVariables.set('ordem', pm.collectionVariables.get('ordem') + '/Prospects');
                `),
              ],
              item: [
                {
                  name: 'F37-01',
                  request: {
                    method: 'POST',
                    url: base + '/prospect',
                    body: {
                      mode: 'raw',
                      raw: '{{f37_prospect_a_body}}',
                      options: { raw: { language: 'json' } },
                    },
                  },
                  event: [
                    before(`
                      if (pm.collectionVariables.get('ordem') !== 'coleção/00a/00a-2/Prospects') {
                        throw new Error('Ordem dos pré-scripts inválida');
                      }
                      if (pm.collectionVariables.has('f37_anterior')) throw new Error('Variável antiga não removida');
                    `),
                    event(
                      'test',
                      `
                      pm.test('Dados enviados', () => pm.expect(pm.response.json()).to.eql({
                        email: 'f37-01@example.test', celular: '11900000001',
                      }));
                    `,
                    ),
                  ],
                },
              ],
            },
          ],
        },
        {
          name: 'F37-02',
          request: base + '/token',
          event: [
            before(`
              const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
              if (!uuid.test(pm.collectionVariables.get('f37_uuid_ausente')) ||
                  pm.collectionVariables.get('f37_email_a') !== 'f37-01@example.test' ||
                  pm.collectionVariables.get('f37_prospect_a') !== 'f37-01@example.test' ||
                  pm.collectionVariables.get('f37_celular_a') !== '11900000001') {
                throw new Error('Variáveis não propagadas');
              }
            `),
          ],
        },
      ],
    })!;
    expect(imported.issues).toEqual([]);
    const collection = importCollection(JSON.parse(JSON.stringify(imported.collection)));
    const { requests } = collection;
    const folderOnly = { ...collection, scripts: undefined };
    expect(hasRunScripts(folderOnly, [{ ...requests[0], scripts: undefined }])).toBe(true);
    expect(hasRunScripts(folderOnly, [{ ...requests[1], scripts: undefined }])).toBe(false);
    const environment = { id: 'dev', name: 'Dev', variables: [], color: '' };
    const snapshot = { collection, environment, requests };
    const run = await runCollection(
      prepareCollection(collection, environment, requests, true),
      () => {},
      requests.map(({ id }) => id),
      hasRunScripts(collection, requests) ? snapshot : undefined,
    );
    expect(run.results.map(({ status, failures }) => ({ status, failures }))).toEqual([
      { status: 200, failures: [] },
      { status: 200, failures: [] },
    ]);
    expect(run.results[0].checks_passed).toBe(2);
  });

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
