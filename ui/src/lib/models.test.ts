import { describe, expect, it } from 'vitest';
import {
  compileRequest,
  compileRequestSnippet,
  authHeaderConflict,
  generatedHeaders,
  isSecretHeader,
  createWorkspace,
  expand,
  importCollection,
  isWorkspace,
  loadWorkspace,
  newRequest,
  pair,
  redactSecrets,
  requestVariables,
  requestsForRun,
  resolveHttpRequest,
  exportableWorkspace,
  exportableCollection,
  syncUrl,
  urlWithQuery,
  validCollection,
  variablesFor,
} from './models';

describe('workspace e coleções', () => {
  it('omite valores marcados no backup sem alterar o workspace local', () => {
    const workspace = createWorkspace();
    const collection = workspace.collections[0];
    const secret = { ...pair('X-Private', 'valor-ficticio', false), secret: true };
    collection.requests[0].headers.push(secret);
    const exported = exportableWorkspace(workspace);
    expect(exported.collections[0].requests[0].headers.at(-1)).toEqual({ ...secret, value: '' });
    expect(workspace.collections[0].requests[0].headers.at(-1)).toEqual(secret);
    expect(isWorkspace(JSON.parse(JSON.stringify(exported)))).toBe(true);
  });
  it('omite credenciais de autorização e de requisição dos arquivos e do cURL', () => {
    const workspace = createWorkspace();
    const collection = workspace.collections[0];
    const [request, second] = collection.requests;
    const environment = workspace.environments[0];
    collection.auth = {
      ...collection.auth,
      type: 'basic',
      username: 'chave-como-usuario',
      password: 'senha-literal',
    };
    request.auth = { ...request.auth, type: 'api-key', key: 'X-Custom', value: 'chave-literal' };
    second.auth = {
      ...second.auth,
      type: 'bearer',
      token: '{{alias_producao}}',
      password: 'senha-inativa',
    };
    request.url = 'https://example.com/items?access_token=token-na-url';
    request.headers = [pair('Cookie', 'session=token-no-header')];
    environment.variables.push(pair('alias_producao', 'token-no-ambiente'));

    const backup = exportableWorkspace(workspace);
    expect(backup.collections[0].requests[1].auth.token).toBe('{{alias_producao}}');
    expect(isWorkspace(backup)).toBe(true);
    const artifacts = JSON.stringify([
      backup,
      compileRequestSnippet(request, collection, environment),
    ]);
    for (const secret of [
      'senha-literal',
      'chave-como-usuario',
      'chave-literal',
      'senha-inativa',
      'token-na-url',
      'token-no-header',
      'token-no-ambiente',
    ])
      expect(artifacts).not.toContain(secret);
    expect(request.auth.value).toBe('chave-literal');
    expect(compileRequest(request, collection, {}).headers).toContainEqual([
      'X-Custom',
      'chave-literal',
    ]);
  });
  it('executa coleção, pasta ou seleção na ordem salva, mesmo com seleção invertida', () => {
    const collection = createWorkspace().collections[0];
    const first = { ...newRequest(), id: 'first', folder: 'A' };
    const second = { ...newRequest(), id: 'second', folder: 'B' };
    const third = { ...newRequest(), id: 'third', folder: 'A' };
    collection.folders = ['A', 'B', 'Vazia'];
    collection.requests = [first, second, third];
    expect(requestsForRun(collection, 'collection', '', [])).toEqual([first, second, third]);
    expect(requestsForRun(collection, 'folder', 'A', [])).toEqual([first, third]);
    expect(requestsForRun(collection, 'folder', 'Vazia', [])).toEqual([]);
    expect(requestsForRun(collection, 'selection', '', ['third', 'missing', 'first'])).toEqual([
      first,
      third,
    ]);
  });
  it('cria uma coleção de exemplo compatível com o motor HTTP', () => {
    const workspace = createWorkspace();
    expect(isWorkspace(workspace)).toBe(true);
    expect(workspace.collections[0].requests).toHaveLength(8);
  });
  it('rejeita versões futuras sem descartar dados', () => {
    expect(isWorkspace({ ...createWorkspace(), version: 100 })).toBe(false);
    expect(isWorkspace({ version: 1, collections: [null] })).toBe(false);
  });
  it('lê o workspace v1 do WebView com as requisições salvas em ordem', () => {
    const workspace = createWorkspace();
    workspace.collections[0].requests.reverse();
    expect(loadWorkspace(JSON.stringify(workspace))).toEqual(workspace);
    expect(() => loadWorkspace('')).toThrow();
    expect(() => loadWorkspace(JSON.stringify({ ...workspace, version: 2 }))).toThrow();
  });
  it('exclui segredos de persistência e backup sem alterar a sessão', () => {
    const workspace = createWorkspace();
    workspace.environments[0].variables.push({ ...pair('token', 'segredo-real'), secret: true });
    const safe = exportableWorkspace(workspace);
    expect(JSON.stringify(safe)).not.toContain('segredo-real');
    expect(workspace.environments[0].variables[1].value).toBe('segredo-real');
  });
  it('dá precedência ao ambiente e ignora variáveis desativadas', () => {
    const workspace = createWorkspace();
    workspace.environments[0].variables = [
      pair('base_url', 'https://api.example.com'),
      pair('inativa', 'não usar', false),
    ];
    expect(variablesFor(workspace.collections[0], workspace.environments[0])).toEqual({
      base_url: 'https://api.example.com',
    });
  });
  it('mascara valores de segredos em diagnósticos, inclusive em URLs codificadas', () => {
    const environment = createWorkspace().environments[0];
    environment.variables.push({ ...pair('token', 'a+b c'), secret: true });
    expect(redactSecrets('Falha com a+b c e a%2Bb%20c', environment)).toBe(
      'Falha com [segredo] e [segredo]',
    );
  });
  it('identifica as origens efetivas e as referências ausentes sem retornar valores', () => {
    const workspace = createWorkspace();
    const collection = workspace.collections[0];
    const environment = workspace.environments[0];
    collection.variables = [
      pair('base', 'coleção'),
      pair('header', 'valor'),
      pair('token', 'antigo'),
    ];
    environment.variables = [pair('base', 'ambiente'), { ...pair('token'), secret: true }];
    const request = {
      ...newRequest(),
      url: '{{base}}/users?filter=%7B%7Bfilter%7D%7D',
      headers: [pair('X-Test', '{{header}}'), pair('X-Ignored', '{{ignored}}', false)],
      auth: {
        ...newRequest().auth,
        type: 'basic' as const,
        username: '{{base}}',
        password: '{{token}}',
      },
      bodyType: 'urlencoded' as const,
      body: '{{texto_inativo}}',
      form: [pair('{{field}}', '{{incomplete')],
    };
    expect(requestVariables(request, collection, environment)).toEqual({
      unclosed: true,
      variables: [
        { name: 'base', source: 'environment' },
        { name: 'header', source: 'collection' },
        { name: 'token', source: undefined },
        { name: 'filter', source: undefined },
        { name: 'field', source: undefined },
      ],
    });
  });
  it('importa o JSON do protótipo anterior', () => {
    const collection = importCollection({
      variables: { base_url: 'http://localhost:8787' },
      requests: [
        {
          name: 'Token',
          request: { method: 'GET', url: '{{base_url}}/token?format=json' },
          tests: [{ type: 'status', equals: 200 }],
          extract: { token: '/token' },
        },
      ],
    });
    expect(validCollection(collection)).toBe(true);
    expect(collection.requests[0].params[0].value).toBe('json');
    expect(collection.requests[0].extract).toEqual({ token: '/token' });
  });
  it('reimporta uma coleção completa sem perder os campos suportados', () => {
    const original = createWorkspace().collections[0];
    Object.assign(original.requests[0], {
      pathParams: [pair('id', '{{user}}')],
      params: [pair('tag', 'a'), pair('tag', 'b', false)],
      headers: [pair('X-Repeat', 'a'), pair('X-Repeat', 'b')],
      bodyType: 'multipart',
      multipart: [
        { ...pair('label', 'demo'), kind: 'field' },
        { ...pair('file', 'C:/test/fixture.bin'), kind: 'file' },
      ],
      timeoutMs: 3500,
      redirectPolicy: 'same_origin',
      tests: [{ type: 'header', name: 'X-Result', equals: 'ok' }],
      extract: { token: '/session/token' },
    });
    Object.assign(original.requests[1], {
      bodyType: 'binary',
      binaryFile: 'C:/test/body.bin',
    });
    const exported = exportableCollection(original);
    const imported = importCollection(JSON.parse(JSON.stringify(exported)));
    expect(imported.id).not.toBe(original.id);
    expect(imported).toEqual({
      ...exported,
      id: imported.id,
      requests: exported.requests.map((request, index) => ({
        ...request,
        id: imported.requests[index].id,
      })),
    });
    expect(
      imported.requests.every((request, index) => request.id !== original.requests[index].id),
    ).toBe(true);
  });
  it('rejeita formatos inválidos no importador Fedexe', () => {
    expect(() => importCollection({ info: {}, item: [] })).toThrow('Unsupported format');
    expect(() =>
      importCollection({ requests: [{ name: 123, request: { url: 'x', method: 'INVALID' } }] }),
    ).toThrow();
  });
});

describe('requisição efetiva', () => {
  const collection = createWorkspace().collections[0];
  it('resolve placeholders e acusa variáveis ausentes antes de enviar', () => {
    expect(expand('{{ base_url }}/users', { base_url: 'http://localhost' })).toBe(
      'http://localhost/users',
    );
    expect(() => expand('{{token}}', {})).toThrow('Missing variable: token');
    expect(() => expand('{{token', {})).toThrow('Unclosed variable');
    expect(() => expand('{{toString}}', {})).toThrow('Missing variable');
    expect(expand('a{{empty}}b', { empty: '' })).toBe('ab');
  });
  it('codifica query parameters, preserva chaves repetidas e desativa linhas', () => {
    const request = {
      ...newRequest(),
      url: 'https://example.com/users',
      params: [pair('tag', 'design & dev'), pair('tag', '{{tag}}'), pair('skip', 'true', false)],
    };
    expect(compileRequest(request, collection, { tag: 'a/b' }).url).toBe(
      'https://example.com/users?tag=design+%26+dev&tag=a%2Fb',
    );
  });
  it('sincroniza a query de uma URL colada com a tabela', () => {
    const request = syncUrl({
      ...newRequest(),
      url: '{{base_url}}/users?tag=a&tag=b&search=ol%C3%A1',
    });
    expect(request.url).toBe('{{base_url}}/users');
    expect(request.params.map((p) => [p.key, p.value])).toEqual([
      ['tag', 'a'],
      ['tag', 'b'],
      ['search', 'olá'],
    ]);
  });
  it('mantém linhas desativadas e coloca a query antes do fragmento', () => {
    const disabled = pair('skip', 'yes', false);
    const request = syncUrl({
      ...newRequest(),
      url: 'https://example.com/users?tag=a%2Bb&tag=#section',
      params: [disabled],
    });
    expect(request.url).toBe('https://example.com/users#section');
    expect(request.params.at(-1)).toEqual(disabled);
    expect(urlWithQuery(request)).toBe('https://example.com/users?tag=a%2Bb&tag=#section');
  });
  it('resolve parâmetros de caminho no editor e no runner com a mesma codificação', () => {
    const request = {
      ...newRequest(),
      url: '{{base}}/users/{id}/{id}?tag=a&tag=b#section',
      pathParams: [pair('id', '{{id}}'), pair('id', 'ignored', false)],
    };
    const vars = { base: 'https://example.com', id: "João / a?'#" };
    const expected =
      'https://example.com/users/Jo%C3%A3o%20%2F%20a%3F%27%23/Jo%C3%A3o%20%2F%20a%3F%27%23?tag=a&tag=b#section';
    expect(compileRequest(request, collection, vars).url).toBe(expected);
    expect(resolveHttpRequest(compileRequest(request, collection, {}, false, true), vars).url).toBe(
      expected,
    );
    expect(() => compileRequest({ ...request, pathParams: [] }, collection, vars)).toThrow(
      'Missing path parameter',
    );
    expect(() => compileRequest(request, collection, { ...vars, id: '..' })).toThrow(
      'Invalid value for path parameter',
    );
  });
  it('valida o JSON após resolver variáveis', () => {
    const request = {
      ...newRequest(),
      url: 'https://example.com',
      method: 'POST' as const,
      bodyType: 'json' as const,
      body: '{"count": {{count}}}',
    };
    expect(compileRequest(request, collection, { count: '2' }).body).toBe('{"count": 2}');
    expect(compileRequest(request, collection, { count: '2' }).headers).toContainEqual([
      'Content-Type',
      'application/json',
    ]);
    expect(() => compileRequest(request, collection, { count: 'inválido' })).toThrow(
      'invalid JSON',
    );
  });
  it('detecta colisões entre autorização e headers manuais', () => {
    const request = {
      ...newRequest(),
      url: 'https://example.com',
      auth: { ...newRequest().auth, type: 'bearer' as const, token: 'token' },
      headers: [pair('authorization', 'manual')],
    };
    expect(() => compileRequest(request, collection, {})).toThrow('Conflicting header');
  });
  it('aplica a autorização herdada e permite desativá-la ou sobrescrevê-la por endpoint', () => {
    const request = {
      ...newRequest(),
      url: 'https://example.com',
      headers: [pair(' x-api-KEY ', 'manual')],
    };
    const c = {
      ...collection,
      auth: { ...collection.auth, type: 'api-key' as const, key: 'X-API-Key', value: '{{secret}}' },
    };
    expect(authHeaderConflict(request, c)).toContain('X-API-Key');
    expect(() => compileRequest(request, c, {}, false, true)).toThrow('Conflicting header');
    const noAuth = { ...request, auth: { ...request.auth, type: 'none' as const } };
    expect(compileRequest(noAuth, c, {}).headers).toEqual([['x-api-KEY', 'manual']]);
    const query = { ...c, auth: { ...c.auth, placement: 'query' as const } };
    const vars = { secret: 'a&b' };
    expect(authHeaderConflict(request, query)).toBeUndefined();
    expect(compileRequest(request, query, vars).url).toBe('https://example.com?X-API-Key=a%26b');
    const basic = {
      ...request,
      auth: { ...request.auth, type: 'basic' as const, username: 'user', password: '{{secret}}' },
      headers: [pair('authorization', 'manual', false)],
    };
    const effective = compileRequest(basic, c, vars);
    expect(effective.headers).toEqual([['Authorization', 'Basic dXNlcjphJmI=']]);
    expect(resolveHttpRequest(compileRequest(basic, c, {}, false, true), vars)).toEqual(effective);
  });
  it('aplica Bearer herdado da coleção', () => {
    const c = {
      ...collection,
      auth: { ...collection.auth, type: 'bearer' as const, token: '{{token}}' },
    };
    expect(
      compileRequest({ ...newRequest(), url: 'https://example.com' }, c, { token: 'session-token' })
        .headers,
    ).toContainEqual(['Authorization', 'Bearer session-token']);
  });
  it('codifica Basic auth com UTF-8', () => {
    const request = {
      ...newRequest(),
      url: 'https://example.com',
      auth: {
        ...newRequest().auth,
        type: 'basic' as const,
        username: 'usuário',
        password: 'senha',
      },
    };
    expect(compileRequest(request, collection, {}).headers).toContainEqual([
      'Authorization',
      `Basic ${Buffer.from('usuário:senha').toString('base64')}`,
    ]);
  });
  it('mantém headers repetidos, ignora linhas desativadas e identifica valores mascarados', () => {
    const request = {
      ...newRequest(),
      url: 'https://example.com/',
      headers: [
        pair('X-Test', 'primeiro'),
        pair('x-test', 'prefixo {{secret}}'),
        pair('X-Test', 'omitido', false),
      ],
      bodyType: 'json' as const,
      body: '{}',
      auth: { ...newRequest().auth, type: 'bearer' as const, token: 'literal' },
    };
    const environment = createWorkspace().environments[0];
    environment.variables.push({ ...pair('secret', 'valor'), secret: true });
    expect(isSecretHeader(request.headers[1], collection, environment)).toBe(true);
    expect(isSecretHeader({ ...request.headers[0], secret: true }, collection)).toBe(true);
    expect(generatedHeaders(request, collection)).toEqual([
      { name: 'Authorization', value: '', secret: true, source: 'Authorization' },
      { name: 'Content-Type', value: 'application/json', secret: false, source: 'Body' },
    ]);
    const vars = { secret: 'valor' };
    const effective = compileRequest(request, collection, vars);
    expect(effective.headers).toEqual([
      ['X-Test', 'primeiro'],
      ['x-test', 'prefixo valor'],
      ['Authorization', 'Bearer literal'],
      ['Content-Type', 'application/json'],
    ]);
    expect(resolveHttpRequest(compileRequest(request, collection, {}, false, true), vars)).toEqual(
      effective,
    );
  });
  it('envia API keys na query e formulários URL encoded', () => {
    const request = {
      ...newRequest(),
      url: 'https://example.com',
      auth: {
        ...newRequest().auth,
        type: 'api-key' as const,
        placement: 'query' as const,
        key: 'api-key',
        value: '{{secret}}',
      },
      bodyType: 'urlencoded' as const,
      form: [pair('name', 'João Silva')],
    };
    const effective = compileRequest(request, collection, { secret: 'a&b' });
    expect(effective.url).toBe('https://example.com?api-key=a%26b');
    expect(effective.body).toBe('name=Jo%C3%A3o+Silva');
  });
  it('recusa protocolos inseguros e credenciais na URL', () => {
    expect(() =>
      compileRequest({ ...newRequest(), url: 'file:///etc/passwd' }, collection, {}),
    ).toThrow('HTTP(S)');
    expect(() =>
      compileRequest({ ...newRequest(), url: 'https://user:password@example.com' }, collection, {}),
    ).toThrow('without credentials');
  });

  it('usa a mesma requisição efetiva no editor e no runner com Basic auth e query codificada', () => {
    const item = {
      ...newRequest(),
      url: '{{base_url}}/users',
      params: [pair('search', '{{search}}')],
      auth: {
        ...newRequest().auth,
        type: 'basic' as const,
        username: '{{username}}',
        password: '{{password}}',
      },
      bodyType: 'urlencoded' as const,
      form: [pair('name', '{{name}}')],
    };
    const variables = {
      base_url: 'https://example.com',
      search: 'a&b / c',
      username: 'usuário',
      password: 'secret',
      name: 'João Silva',
    };
    const editor = compileRequest(item, collection, variables);
    const runner = resolveHttpRequest(
      compileRequest(item, collection, variables, false, true),
      variables,
    );
    expect(runner).toEqual(editor);
  });

  it('não usa o valor da coleção quando um segredo do ambiente está vazio', () => {
    const workspace = createWorkspace();
    workspace.collections[0].variables.push(pair('token', 'não utilizar'));
    workspace.environments[0].variables.push({ ...pair('token'), secret: true });
    expect(variablesFor(workspace.collections[0], workspace.environments[0])).not.toHaveProperty(
      'token',
    );
  });
});
