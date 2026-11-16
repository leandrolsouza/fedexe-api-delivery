import { describe, expect, it, vi } from 'vitest';
import { compileRequest, variablesFor } from './models';
import {
  importPostmanItems,
  listPostmanWorkspaces,
  loadPostmanSpecs,
  readPostmanWorkspace,
  unsupportedPostmanIssues,
  type PostmanGet,
} from './postman-workspace';

const collection = (name: string) => ({
  info: { name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  event: [{ listen: 'prerequest', script: { exec: ['pm.variables.set("scope", "workspace");'] } }],
  item: [
    {
      name: 'Health',
      item: [
        {
          name: 'First',
          request: { method: 'GET', url: '{{base_url}}/first' },
          event: [
            {
              listen: 'test',
              script: { exec: 'pm.test("OK", () => pm.response.to.have.status(200));' },
            },
          ],
        },
        { name: 'Second', request: { method: 'GET', url: '{{base_url}}/second' }, response: [{}] },
      ],
    },
  ],
});

const workspace = readPostmanWorkspace({
  workspace: {
    name: 'Acme',
    collections: [
      { name: 'Orders', uid: '123-orders', id: 'orders' },
      { name: 'Accounts', id: 'accounts' },
    ],
    environments: [
      { name: 'Local', uid: '123-local', id: 'local' },
      { name: 'Dev', uid: '123-dev', id: 'dev' },
    ],
    mocks: [{}],
    specs: [{}],
  },
});

describe('Postman workspace import', () => {
  it('reads pages with a cursor', () => {
    expect(
      listPostmanWorkspaces({
        workspaces: [{ id: 'acme', name: 'Acme' }],
        meta: { nextCursor: 'next=' },
      }),
    ).toEqual({ items: [{ id: 'acme', name: 'Acme' }], cursor: 'next=' });
  });

  it('imports multiple collections and environments in order and keeps secrets out of the models', async () => {
    const get = vi.fn<PostmanGet>(async (resource) => {
      if (resource.kind === 'collection') {
        return { collection: collection(resource.id === '123-orders' ? 'Orders' : 'Accounts') };
      }
      if (resource.kind !== 'environment') throw new Error('unexpected');
      return {
        environment: {
          name: resource.id === '123-local' ? 'Local' : 'Dev',
          values: [
            { key: 'base_url', value: 'http://127.0.0.1:1421' },
            { key: 'token', type: 'default', secret: true, value: 'example-vault-secret' },
          ],
        },
      };
    });
    const result = await importPostmanItems(
      workspace.items,
      get,
      unsupportedPostmanIssues(workspace),
    );
    expect(result.collections.map(({ name }) => name)).toEqual(['Orders', 'Accounts']);
    expect(result.environments.map(({ name }) => name)).toEqual(['Local', 'Dev']);
    expect(get.mock.calls.map(([resource]) => resource)).toEqual([
      { kind: 'collection', id: '123-orders' },
      { kind: 'collection', id: 'accounts' },
      { kind: 'environment', id: '123-local' },
      { kind: 'environment', id: '123-dev' },
    ]);
    const imported = result.collections[0];
    expect(imported.scripts?.before).toBe('pm.variables.set("scope", "workspace");');
    expect(imported.requests[0].scripts?.after).toBe(
      'pm.test("OK", () => pm.response.to.have.status(200));',
    );
    expect(imported.folders).toEqual(['Health']);
    expect(imported.requests.map(({ name }) => name)).toEqual(['First', 'Second']);
    expect(
      compileRequest(imported.requests[0], imported, variablesFor(imported, result.environments[0]))
        .url,
    ).toBe('http://127.0.0.1:1421/first');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'Mocks: 1 unsupported item(s).',
        'OpenAPI: 1 unsupported item(s).',
        'Second: response examples were skipped.',
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('example-vault-secret');
    expect(result.environments[0].variables[1]).toMatchObject({
      key: 'token',
      value: '',
      secret: true,
    });
  });

  it('only downloads selected items and keeps successful imports when another item fails', async () => {
    const get = vi.fn<PostmanGet>(async (resource) => {
      if (resource.kind === 'collection' && resource.id === '123-orders') {
        throw 'notFound';
      }
      return { collection: collection('Accounts') };
    });
    const result = await importPostmanItems(workspace.items.slice(0, 2), get, []);
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.collections.map(({ name }) => name)).toEqual(['Accounts']);
    expect(result.environments).toEqual([]);
    expect(result.issues[0]).toContain('Orders');
    expect(result.issues[0]).toContain('no longer available');
  });
});

it('lists compatible specs across Postman pages and imports each definition with an environment', async () => {
  const get: PostmanGet = vi.fn(async (resource) => {
    if (resource.kind === 'specs' && !resource.cursor)
      return {
        specs: [{ id: 'async', name: 'Async', type: 'ASYNCAPI:2.0' }],
        meta: { nextCursor: 'next' },
      };
    if (resource.kind === 'specs')
      return { specs: [{ id: 'openapi', name: 'HTTP', type: 'OPENAPI:3.1' }] };
    if (resource.kind === 'spec' && resource.id === 'openapi')
      return {
        openapi: '3.1.0',
        info: { title: 'HTTP' },
        servers: [{ url: 'https://example.test' }],
        paths: { '/health': { get: {} } },
      };
    throw new Error('unexpected resource');
  });
  const listed = await loadPostmanSpecs(workspace, 'workspace', get);
  const result = await importPostmanItems(
    listed.items.filter((item) => item.kind === 'spec'),
    get,
    [],
  );
  expect(listed.unsupported).toContainEqual({ type: 'specs', count: 1 });
  expect(result.collections[0].requests[0].url).toBe('{{base_url}}/health');
  expect(result.environments[0].variables[0].value).toBe('https://example.test');
  expect(result.issues).toEqual([]);
});
