import {
  emptyAuth,
  newRequest,
  pair,
  syncUrl,
  type Collection,
  type Environment,
  type Method,
  type Pair,
} from './models';
import { uid } from './utils';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export function importPostman(value: unknown) {
  const data = object(value);
  const issues: string[] = [];
  function variables(input: unknown, label: string): Pair[] {
    return list(input).flatMap((raw) => {
      const item = object(raw);
      const key = str(item.key);
      if (!key) {
        issues.push(`${label}: variável sem nome ignorada.`);
        return [];
      }
      const secret = item.type === 'secret';
      if (secret) issues.push(`${label}: configure o segredo ${key} no Fedexe.`);
      if (
        !secret &&
        item.value != null &&
        !['string', 'number', 'boolean'].includes(typeof item.value)
      ) {
        issues.push(`${label}: o valor de ${key} precisa ser configurado.`);
      }
      const text = ['string', 'number', 'boolean'].includes(typeof item.value)
        ? String(item.value)
        : '';
      return [
        {
          ...pair(key, secret ? '' : text, item.enabled !== false && item.disabled !== true),
          ...(secret ? { secret: true } : {}),
        },
      ];
    });
  }
  if (data._postman_variable_scope === 'environment') {
    if (!Array.isArray(data.values))
      throw new Error('O ambiente Postman não contém uma lista de variáveis.');
    const name = str(data.name) || 'Ambiente Postman';
    const environment: Environment = {
      id: uid(),
      name,
      color: 'purple',
      variables: variables(data.values, name),
    };
    return { environment, issues };
  }
  const info = object(data.info);
  if (!str(info.schema).includes('schema.getpostman.com/json/collection/')) return;
  if (!Array.isArray(data.item))
    throw new Error('A coleção Postman não contém uma lista de itens.');
  const name = str(info.name) || 'Coleção Postman';
  const collection: Collection = {
    id: uid(),
    name,
    description: str(info.description),
    folders: [],
    variables: variables(data.variable, name),
    auth: emptyAuth(),
    requests: [],
  };
  function auth(value: unknown, label: string, fallback = emptyAuth()) {
    if (value == null) return fallback;
    const config = object(value);
    const type = str(config.type);
    const settings = new Map(
      list(config[type]).map((entry) => {
        const field = object(entry);
        return [str(field.key), str(field.value)];
      }),
    );
    if (type === 'noauth') return emptyAuth();
    if (type === 'bearer')
      return { ...emptyAuth(), type: 'bearer' as const, token: settings.get('token') ?? '' };
    if (type === 'basic')
      return {
        ...emptyAuth(),
        type: 'basic' as const,
        username: settings.get('username') ?? '',
        password: settings.get('password') ?? '',
      };
    if (type === 'apikey')
      return {
        ...emptyAuth(),
        type: 'api-key' as const,
        key: settings.get('key') ?? '',
        value: settings.get('value') ?? '',
        placement: settings.get('in') === 'query' ? ('query' as const) : ('header' as const),
      };
    issues.push(`${label}: autorização ${type || 'desconhecida'} precisa ser configurada.`);
    return emptyAuth();
  }
  function report(
    value: Record<string, unknown>,
    label: string,
    endpoint?: Collection['requests'][number],
  ) {
    let unsupported = false;
    for (const raw of list(value.event)) {
      const event = object(raw);
      if (event.disabled === true) continue;
      const exec = object(event.script).exec;
      if (!endpoint || event.listen !== 'test' || !Array.isArray(exec) || !exec.length) {
        unsupported = true;
        continue;
      }
      const tests: typeof endpoint.tests = [];
      const extract: typeof endpoint.extract = Object.create(null);
      let supported = true;
      for (const line of exec) {
        if (typeof line !== 'string') {
          supported = false;
          break;
        }
        if (!line.trim()) continue;
        const status = line
          .trim()
          .match(
            /^pm\.test\('Status ([1-5]\d\d)', \(\) => pm\.response\.to\.have\.status\(\1\)\);$/,
          );
        const extraction = line
          .trim()
          .match(/^pm\.collectionVariables\.set\('([\w-]+)', pm\.response\.json\(\)\.([\w$]+)\);$/);
        if (status) tests.push({ type: 'status', equals: Number(status[1]) });
        else if (extraction) extract[extraction[1]] = '/' + extraction[2];
        else {
          supported = false;
          break;
        }
      }
      if (supported) {
        endpoint.tests.push(...tests);
        endpoint.extract = { ...endpoint.extract, ...extract };
      } else unsupported = true;
    }
    if (unsupported) issues.push(`${label}: scripts não importados.`);
    if (list(value.response).length) issues.push(`${label}: exemplos de resposta não importados.`);
  }
  report(data, name);
  collection.auth = auth(data.auth, name);
  function visit(
    items: unknown[],
    folder: string,
    parentAuth = { ...emptyAuth(), type: 'inherit' } as Collection['auth'],
  ) {
    for (const raw of items) {
      const item = object(raw);
      const label = str(item.name) || 'Item Postman';
      if (Array.isArray(item.item)) {
        report(item, label);
        const base = folder ? `${folder} / ${label}` : label;
        let path = base;
        for (let suffix = 2; collection.folders.includes(path); suffix++)
          path = `${base} (${suffix})`;
        collection.folders.push(path);
        if (folder) issues.push(`${path}: pasta aninhada representada como pasta plana.`);
        visit(item.item, path, auth(item.auth, path, parentAuth));
        continue;
      }
      const request =
        typeof item.request === 'string' ? { url: item.request } : object(item.request);
      const method = (str(request.method) || 'GET').toUpperCase();
      const url = object(request.url);
      const rawUrl = typeof request.url === 'string' ? request.url : str(url.raw);
      if (!methods.has(method) || !rawUrl) {
        issues.push(`${label}: método ou URL sem suporte. Requisição ignorada.`);
        continue;
      }
      const endpoint = syncUrl({
        ...newRequest(folder),
        name: label,
        method: method as Method,
        url: rawUrl,
        description: str(request.description),
        tests: [],
        auth: auth(request.auth, label, parentAuth),
        headers: variables(request.header, label),
      });
      report(item, label, endpoint);
      if (Array.isArray(url.query)) endpoint.params = variables(url.query, label);
      endpoint.pathParams = variables(url.variable, label);
      if (endpoint.pathParams.length) {
        const names = new Set(endpoint.pathParams.map(({ key }) => key));
        endpoint.url = endpoint.url.replace(/\/:([\w-]+)(?=\/|#|$)/g, (match, key) =>
          names.has(key) ? `/{${key}}` : match,
        );
      }
      const body = object(request.body);
      if (body.disabled !== true && body.mode === 'raw') {
        endpoint.body = str(body.raw);
        endpoint.bodyType = object(object(body.options).raw).language === 'json' ? 'json' : 'text';
      } else if (body.disabled !== true && body.mode === 'urlencoded') {
        endpoint.bodyType = 'urlencoded';
        endpoint.form = variables(body.urlencoded, label);
      } else if (body.disabled !== true && body.mode === 'formdata') {
        endpoint.bodyType = 'multipart';
        endpoint.multipart = list(body.formdata).flatMap((raw) => {
          const field = object(raw);
          const key = str(field.key);
          if (!key) return [];
          if (field.type === 'file') issues.push(`${label}: selecione o arquivo da parte ${key}.`);
          return [
            {
              ...pair(key, field.type === 'file' ? '' : str(field.value), field.disabled !== true),
              kind: field.type === 'file' ? ('file' as const) : ('field' as const),
            },
          ];
        });
      } else if (body.disabled !== true && body.mode === 'file') {
        endpoint.bodyType = 'binary';
        issues.push(`${label}: selecione o arquivo binário.`);
      } else if (body.disabled !== true && body.mode) {
        issues.push(`${label}: corpo ${str(body.mode)} precisa ser configurado.`);
      }
      collection.requests.push(endpoint);
    }
  }
  visit(data.item, '');
  return { collection, issues };
}
