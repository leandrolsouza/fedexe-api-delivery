import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { prepareCollection } from './collection-runner';
import { exportableWorkspace, createWorkspace } from './models';
import { importOpenApi, parseImport } from './openapi';
import { runCollection } from './transport';

const spec = {
  openapi: '3.1.0',
  info: { title: 'Orders', version: '1' },
  servers: [{ url: 'http://127.0.0.1:{port}/api', variables: { port: { default: '1234' } } }],
  security: [{ key: [] }],
  components: {
    securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-Key' } },
    parameters: { id: { name: 'order.id', in: 'path', required: true, example: 'a/b' } },
  },
  paths: {
    '/orders/{order.id}': {
      parameters: [{ $ref: '#/components/parameters/id' }],
      post: {
        tags: ['Orders', 'Write'],
        parameters: [
          { name: 'preview', in: 'query', schema: { default: false } },
          { name: 'X-Mode', in: 'header', example: 'local' },
        ],
        requestBody: {
          content: { 'application/json': { examples: { sample: { value: { count: 2 } } } } },
        },
        responses: { 201: { description: 'Created' } },
      },
      get: {
        security: [],
        responses: { 200: { description: 'OK' } },
      },
    },
  },
};

it('imports equivalent JSON and YAML and runs both collections against a local server', async () => {
  const seen = vi.fn();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    seen(
      req.method,
      req.url,
      req.headers['x-key'],
      req.headers['x-mode'],
      Buffer.concat(chunks).toString(),
    );
    res.writeHead(req.method === 'POST' ? 201 : 200).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const results = [JSON.stringify(spec), stringify(spec)].map((text) =>
      importOpenApi(parseImport(text))!,
    );
    const withoutIds = (value: unknown) =>
      JSON.stringify(value, (key, entry) => (key === 'id' ? undefined : entry));
    expect(withoutIds(results[0])).toBe(withoutIds(results[1]));
    for (const { collection, environment } of results) {
      expect(collection.folders).toEqual(['Orders']);
      const baseUrl = environment.variables.find((row) => row.key === 'base_url')!;
      const credential = environment.variables.find((row) => row.secret)!;
      expect(baseUrl.value).toBe('http://127.0.0.1:1234/api');
      baseUrl.value = 'http://127.0.0.1:' + port + '/api';
      credential.value = 'fixture-only';

      const exported = exportableWorkspace({
        ...createWorkspace(),
        collections: [collection],
        environments: [environment],
      });
      expect(JSON.stringify(exported)).not.toContain('fixture-only');
      const result = await runCollection(
        prepareCollection(collection, environment, collection.requests, true),
        () => {},
      );
      expect(result.results.map((row) => [row.status, row.failures])).toEqual([
        [201, []],
        [200, []],
      ]);
    }
    expect(seen.mock.calls).toEqual([
      ['POST', '/api/orders/a%2Fb?preview=false', 'fixture-only', 'local', '{\n  "count": 2\n}'],
      ['GET', '/api/orders/a%2Fb', undefined, undefined, ''],
      ['POST', '/api/orders/a%2Fb?preview=false', 'fixture-only', 'local', '{\n  "count": 2\n}'],
      ['GET', '/api/orders/a%2Fb', undefined, undefined, ''],
    ]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it('reports unsupported input and handles OpenAPI 3.0', () => {
  const imported = importOpenApi({
    ...spec,
    openapi: '3.0.4',
    servers: [{ url: '/relative' }],
    paths: {
      '/orders': {
        post: { requestBody: { $ref: './other.yaml#/Body' } },
        trace: {},
      },
    },
  })!;
  expect(imported.environment.variables.find((row) => row.key === 'base_url')?.value).toBe('');
  expect(imported.collection.requests.map(({ method }) => method)).toEqual(['POST']);
  expect(imported.issues.join('\n')).toMatch(
    /unsupported HTTP method[\s\S]*unresolved OpenAPI reference/,
  );
  expect(() => importOpenApi({ ...spec, openapi: '3.2.0' })).toThrow(/3\.0 or 3\.1/);
  expect(() => parseImport('openapi: [')).toThrow(/valid OpenAPI/);
});

it('maps supported OAuth grants and carries scopes without importing credentials', () => {
  const imported = importOpenApi({
    ...spec,
    security: [{ oauth: ['orders:read', 'orders:write'] }],
    components: {
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          flows: {
            clientCredentials: { tokenUrl: 'https://auth.example.test/token' },
          },
        },
        pkce: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://auth.example.test/authorize',
              tokenUrl: 'https://auth.example.test/token',
            },
          },
        },
      },
    },
    paths: { '/orders': { post: {}, get: { security: [{ pkce: ['orders:read'] }] } } },
  })!;
  expect(imported.collection.auth.oauth).toEqual({
    grant: 'client_credentials',
    token_url: 'https://auth.example.test/token',
    authorization_url: '',
    client_id: '{{openapi_oauth_client_id}}',
    client_secret: '{{openapi_oauth_client_secret}}',
    scope: 'orders:read orders:write',
  });
  expect(imported.environment.variables.find((row) => row.secret)).toMatchObject({
    key: 'openapi_oauth_client_secret',
    value: '',
  });
  expect(imported.collection.requests[1].auth.oauth).toMatchObject({
    grant: 'pkce',
    authorization_url: 'https://auth.example.test/authorize',
    token_url: 'https://auth.example.test/token',
    client_id: '',
    scope: 'orders:read',
  });
});
