import { t } from './i18n';
import { folderPath } from './folders';
import {
  emptyAuth,
  newRequest,
  pair,
  rawBodyFormats,
  syncUrl,
  type Collection,
  type Environment,
  type Method,
  type Pair,
} from './models';
import type { Scripts } from './scripts';
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
        issues.push(t('{0}: variável sem nome ignorada.', label));
        return [];
      }
      const secret = item.type === 'secret' || item.secret === true;
      if (secret) issues.push(t('{0}: configure o segredo {1} no Fedexe.', label, key));
      if (
        !secret &&
        item.value != null &&
        !['string', 'number', 'boolean'].includes(typeof item.value)
      ) {
        issues.push(t('{0}: o valor de {1} precisa ser configurado.', label, key));
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
      throw new Error(t('O ambiente Postman não contém uma lista de variáveis.'));
    const name = str(data.name) || t('Ambiente Postman');
    const environment: Environment = {
      id: uid(),
      name,
      color: 'purple',
      variables: variables(data.values, name),
    };
    return { environment, issues };
  }
  const info = object(data.info);
  if (!/^https?:\/\/schema\.(?:getpostman|postman)\.com\/json\/collection\//.test(str(info.schema)))
    return;
  if (!Array.isArray(data.item))
    throw new Error(t('A coleção Postman não contém uma lista de itens.'));
  const name = str(info.name) || t('Coleção Postman');
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
    issues.push(
      t('{0}: autorização {1} precisa ser configurada.', label, type || t('desconhecida')),
    );
    return emptyAuth();
  }
  function importEvents(
    value: Record<string, unknown>,
    label: string,
    target: Collection | Collection['requests'][number] | string,
  ) {
    const sources: Record<keyof Scripts, string[]> = { before: [], after: [] };
    let skipped = false;
    for (const raw of list(value.event)) {
      const event = object(raw);
      const script = object(event.script);
      if (event.disabled === true || script.disabled === true) continue;
      const phase =
        event.listen === 'prerequest' ? 'before' : event.listen === 'test' ? 'after' : undefined;
      const { exec } = script;
      const source =
        typeof exec === 'string'
          ? exec
          : Array.isArray(exec) && exec.every((line) => typeof line === 'string')
            ? exec.join('\n')
            : undefined;
      if (source === undefined) {
        skipped = true;
        continue;
      }
      if (!source.trim()) continue;
      if (phase) sources[phase].push(source);
      else skipped = true;
    }
    if (typeof target === 'string') {
      if (sources.before.length) {
        const folderScripts = (collection.folderPreRequests ??= Object.create(null));
        folderScripts[target] = sources.before;
      }
      if (sources.after.length) {
        const folderScripts = (collection.folderPostResponses ??= Object.create(null));
        folderScripts[target] = sources.after;
      }
    } else if (sources.before.length || sources.after.length) {
      target.scripts = {
        ...(sources.before.length ? { before: sources.before.join('\n;\n') } : {}),
        ...(sources.after.length ? { after: sources.after.join('\n;\n') } : {}),
      };
    }
    if (skipped) issues.push(t('{0}: alguns scripts não foram importados.', label));
    if (list(value.response).length)
      issues.push(t('{0}: exemplos de resposta não importados.', label));
  }
  importEvents(data, name, collection);
  collection.auth = auth(data.auth, name);
  function visit(
    items: unknown[],
    folder: string,
    parentAuth = { ...emptyAuth(), type: 'inherit' } as Collection['auth'],
  ) {
    for (const raw of items) {
      const item = object(raw);
      const label = str(item.name) || t('Item Postman');
      if (Array.isArray(item.item)) {
        const base = folderPath(folder, label);
        let path = base;
        for (let suffix = 2; collection.folders.includes(path); suffix++)
          path = `${base} (${suffix})`;
        collection.folders.push(path);
        importEvents(item, label, path);
        visit(item.item, path, auth(item.auth, path, parentAuth));
        continue;
      }
      const request =
        typeof item.request === 'string' ? { url: item.request } : object(item.request);
      const method = (str(request.method) || 'GET').toUpperCase();
      const url = object(request.url);
      const rawUrl = typeof request.url === 'string' ? request.url : str(url.raw);
      if (!methods.has(method) || !rawUrl) {
        issues.push(t('{0}: método ou URL sem suporte. Requisição ignorada.', label));
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
      importEvents(item, label, endpoint);
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
        const language = object(object(body.options).raw).language;
        const format = rawBodyFormats.find((format) => format === language);
        endpoint.bodyType = format === 'json' ? 'json' : 'text';
        if (format && format !== 'json') endpoint.rawFormat = format;
      } else if (body.disabled !== true && body.mode === 'graphql') {
        const graphql = object(body.graphql);
        endpoint.bodyType = 'graphql';
        endpoint.graphql = {
          query: str(graphql.query),
          variables:
            graphql.variables && typeof graphql.variables === 'object'
              ? JSON.stringify(graphql.variables, null, 2)
              : str(graphql.variables),
        };
      } else if (body.disabled !== true && body.mode === 'urlencoded') {
        endpoint.bodyType = 'urlencoded';
        endpoint.form = variables(body.urlencoded, label);
      } else if (body.disabled !== true && body.mode === 'formdata') {
        endpoint.bodyType = 'multipart';
        endpoint.multipart = list(body.formdata).flatMap((raw) => {
          const field = object(raw);
          const key = str(field.key);
          if (!key) return [];
          if (field.type === 'file')
            issues.push(t('{0}: selecione o arquivo da parte {1}.', label, key));
          return [
            {
              ...pair(key, field.type === 'file' ? '' : str(field.value), field.disabled !== true),
              kind: field.type === 'file' ? ('file' as const) : ('field' as const),
            },
          ];
        });
      } else if (body.disabled !== true && body.mode === 'file') {
        endpoint.bodyType = 'binary';
        issues.push(t('{0}: selecione o arquivo binário.', label));
      } else if (body.disabled !== true && body.mode) {
        issues.push(t('{0}: corpo {1} precisa ser configurado.', label, str(body.mode)));
      }
      collection.requests.push(endpoint);
    }
  }
  visit(data.item, '');
  return { collection, issues };
}
