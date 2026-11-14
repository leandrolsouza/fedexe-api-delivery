import { describe, expect, it } from 'vitest';
import { importCollection, isEnvironment, safeEnvironment, validCollection } from './models';
import { importPostman } from './postman';

describe('migração do Postman', () => {
  it('converte as regras simples do cenário de benchmark sem executar JavaScript', () => {
    const status = "pm.test('Status 200', () => pm.response.to.have.status(200));";
    const token = "pm.collectionVariables.set('token', pm.response.json().token);";
    const endpoint = (name: string, exec: string[]) => ({
      name,
      request: 'https://example.test',
      event: [{ listen: 'test', script: { exec } }],
    });
    const result = importPostman({
      info: {
        name: 'Benchmark',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [endpoint('Login', [status, token]), endpoint('Outro', [status, 'custom();'])],
    })!;
    expect(result.collection?.requests[0]).toMatchObject({
      tests: [{ type: 'status', equals: 200 }],
      extract: { token: '/token' },
    });
    expect(result.collection?.requests[1].tests).toEqual([]);
    expect(result.issues).toEqual(['Outro: scripts não importados.']);
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
      'API: scripts não importados.',
      'Upload: selecione o arquivo da parte upload.',
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
