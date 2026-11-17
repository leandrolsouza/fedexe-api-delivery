import { describe, expect, it } from 'vitest';
import { importCollection, isEnvironment, safeEnvironment, validCollection } from './models';
import { importPostman } from './postman';
import { indexFolders } from './folders';

describe('migração do Postman', () => {
  it('preserva o formato raw e os campos GraphQL do Postman', () => {
    const result = importPostman({
      info: {
        name: 'API',
        schema: 'https://schema.postman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'XML',
          request: {
            url: 'https://example.test',
            body: {
              mode: 'raw',
              raw: '<item />',
              options: { raw: { language: 'xml' } },
            },
          },
        },
        {
          name: 'GraphQL',
          request: {
            url: 'https://example.test/graphql',
            body: {
              mode: 'graphql',
              graphql: { query: '{ items { id } }', variables: '{"limit":2}' },
            },
          },
        },
      ],
    })!;
    expect(result.issues).toEqual([]);
    expect(result.collection?.requests).toMatchObject([
      { bodyType: 'text', rawFormat: 'xml', body: '<item />' },
      { bodyType: 'graphql', graphql: { query: '{ items { id } }', variables: '{"limit":2}' } },
    ]);
  });
  it('reconstrói a hierarquia a partir dos caminhos salvos de pastas Postman', () => {
    const result = importPostman({
      info: {
        name: 'API',
        schema: 'https://schema.postman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Flows',
          item: [
            { name: 'Cadastro', item: [{ name: 'Listar', request: 'https://example.test' }] },
            { name: 'Vazia', item: [] },
          ],
        },
      ],
    })!;
    const collection = importCollection(JSON.parse(JSON.stringify(result.collection)));
    const folders = indexFolders(collection.folders);
    expect(folders.get('')).toEqual(['Flows']);
    expect(folders.get('Flows')).toEqual(['Flows / Cadastro', 'Flows / Vazia']);
    expect(collection.requests[0].folder).toBe('Flows / Cadastro');
    expect(result.issues).toEqual([]);
  });
  it('copia scripts ativos da coleção e da requisição sem duplicar testes declarativos', () => {
    const status = "pm.test('Status 200', () => pm.response.to.have.status(200));";
    const token = "pm.collectionVariables.set('token', pm.response.json().token);";
    const event = (listen: string, exec: unknown) => ({ listen, script: { exec } });
    const result = importPostman({
      info: {
        name: 'Scripts',
        schema: 'https://schema.postman.com/json/collection/v2.1.0/collection.json',
      },
      event: [
        event('prerequest', ['// Prepare requests', 'pm.variables.set("scope", "collection");']),
        event('prerequest', 'pm.variables.set("order", "second");'),
        event('test', status),
        { ...event('prerequest', 'disabled()'), disabled: true },
      ],
      item: [
        {
          name: 'Pasta',
          event: [event('prerequest', 'folderScript();')],
          item: [
            {
              name: 'Login',
              request: 'https://example.test',
              event: [
                event('test', [status, '', token]),
                event('prerequest', 'pm.variables.set("request", "login");'),
                { listen: 'test', script: { exec: ['disabled()'], disabled: true } },
                event('test', ['  ']),
                event('test', ['broken();', 42]),
              ],
            },
          ],
        },
      ],
    })!;
    const collection = result.collection!;
    expect(collection.scripts).toEqual({
      before:
        '// Prepare requests\npm.variables.set("scope", "collection");\n;\npm.variables.set("order", "second");',
      after: status,
    });
    expect(collection.requests[0]).toMatchObject({
      scripts: {
        before: 'pm.variables.set("request", "login");',
        after: [status, '', token].join('\n'),
      },
      tests: [],
      extract: {},
    });
    expect(result.issues).toEqual([
      'Pasta: some scripts were skipped.',
      'Login: some scripts were skipped.',
    ]);
    const imported = importCollection(JSON.parse(JSON.stringify(collection)));
    expect(imported.scripts).toEqual(collection.scripts);
    expect(imported.requests[0].scripts).toEqual(collection.requests[0].scripts);
  });

  it('preserva ordem, parâmetros, cabeçalhos repetidos e autorização da pasta em um round-trip', () => {
    const result = importPostman({
      info: {
        name: 'API',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      event: [{ listen: 'test' }],
      item: [
        {
          name: 'Usuários',
          auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
          item: [
            {
              name: 'Consulta',
              request: {
                method: 'GET',
                url: {
                  raw: '{{base}}/users/:id?tag=a',
                  query: [
                    { key: 'tag', value: 'a' },
                    { key: 'tag', value: 'b', disabled: true },
                  ],
                  variable: [{ key: 'id', value: '123' }],
                },
                header: [
                  { key: 'X-Test', value: 'a' },
                  { key: 'X-Test', value: 'b' },
                ],
              },
            },
            {
              name: 'Upload',
              request: {
                method: 'POST',
                url: '{{base}}/upload',
                body: {
                  mode: 'formdata',
                  formdata: [{ key: 'upload', type: 'file', src: '/local/file' }],
                },
              },
            },
          ],
        },
      ],
    })!;
    const collection = result.collection!;
    expect(validCollection(collection)).toBe(true);
    expect(collection.requests.map(({ name }) => name)).toEqual(['Consulta', 'Upload']);
    const [request] = collection.requests;
    expect(request.url).toBe('{{base}}/users/{id}');
    expect(request.params.map(({ enabled }) => enabled)).toEqual([true, false]);
    expect(request.headers.map(({ value }) => value)).toEqual(['a', 'b']);
    expect(request.auth.token).toBe('{{token}}');
    expect(result.issues).toEqual([
      'API: some scripts were skipped.',
      'Upload: select the file for part upload.',
    ]);
    const imported = importCollection(JSON.parse(JSON.stringify(collection)));
    expect(imported.requests.map(({ id, ...request }) => request)).toEqual(
      collection.requests.map(({ id, ...request }) => request),
    );
  });

  it('preserva a estrutura do ambiente sem transportar o valor marcado como secreto', () => {
    const result = importPostman({
      _postman_variable_scope: 'environment',
      name: 'Dev',
      values: [
        { key: 'base', value: 'https://example.test', enabled: true },
        { key: 'token', value: 'should-not-copy', type: 'secret', enabled: false },
      ],
    })!;
    const exported = JSON.stringify(safeEnvironment(result.environment!));
    expect(exported).not.toContain('should-not-copy');
    expect(isEnvironment(JSON.parse(exported))).toBe(true);
    expect(JSON.parse(exported).variables[1]).toMatchObject({
      key: 'token',
      value: '',
      secret: true,
      enabled: false,
    });
    expect(result.issues).toHaveLength(1);
  });
});
