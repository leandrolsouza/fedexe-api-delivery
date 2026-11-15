import { parseDocument } from 'yaml';
import { t } from './i18n';
import {
  emptyAuth,
  newRequest,
  pair,
  type Collection,
  type Environment,
  type Method,
} from './models';
import { uid } from './utils';

const methods = new Set<string>(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.assign(Object.create(null), value)
    : Object.create(null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const scalar = (value: unknown) =>
  ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : undefined;

export function parseImport(text: string): unknown {
  const source = text.replace(/^\uFEFF/, '');
  try {
    return JSON.parse(source);
  } catch {
    try {
      const document = parseDocument(source, { schema: 'core' });
      if (document.errors.length) throw new Error();
      const data: unknown = document.toJS({ maxAliasCount: 50 });
      if (Object.hasOwn(object(data), 'openapi')) return data;
    } catch {
      // Parser diagnostics can include the contents of the imported file.
    }
    throw new Error(t('Informe um JSON válido ou uma especificação OpenAPI em YAML válida.'));
  }
}

export function importOpenApi(value: unknown) {
  const document = object(value);
  if (!Object.hasOwn(document, 'openapi')) return;
  if (!/^3\.[01]\.\d+(?:[-+][\w.-]+)?$/.test(str(document.openapi)))
    throw new Error(t('A importação requer OpenAPI 3.0 ou 3.1.'));
  const info = object(document.info);
  const name = str(info.title) || 'OpenAPI';
  const collection: Collection = {
    id: uid(),
    name,
    description: str(info.description),
    folders: [],
    variables: [],
    auth: emptyAuth(),
    requests: [],
  };
  const environment: Environment = { id: uid(), name, color: 'purple', variables: [] };
  const issues = new Set<string>();
  const serverKeys = new Map<string, string>();
  const secretKeys = new Map<string, string>();

  function resolve(raw: unknown, label: string) {
    const seen = new Set<string>();
    let entry = object(raw);
    while (Object.hasOwn(entry, '$ref')) {
      const ref = str(entry.$ref);
      if (!ref.startsWith('#/') || seen.has(ref) || seen.size >= 32) break;
      seen.add(ref);
      let target: unknown = document;
      try {
        for (const part of decodeURIComponent(ref.slice(2)).split('/')) {
          target = object(target)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
        }
      } catch {
        break;
      }
      if (target === undefined) break;
      entry = object(target);
    }
    if (Object.hasOwn(entry, '$ref')) {
      issues.add(t('{0}: referência OpenAPI não resolvida ({1}).', label, str(entry.$ref)));
      return object(undefined);
    }
    return entry;
  }

  function serverVariable(servers: unknown[], label: string) {
    const server = object(servers[0]);
    if (servers.length > 1) issues.add(t('{0}: foi importado apenas o primeiro servidor.', label));
    const url = str(server.url).replace(
      /\{([^{}]+)\}/g,
      (_, key: string) => scalar(object(object(server.variables)[key]).default) ?? '{' + key + '}',
    );
    let baseUrl = '';
    try {
      const parsed = new URL(url);
      if (
        /^https?:$/.test(parsed.protocol) &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash &&
        !/[{}]/.test(url)
      )
        baseUrl = url.replace(/\/+$/, '');
    } catch {
      // A file import has no origin against which to resolve relative server URLs.
    }
    if (!baseUrl) issues.add(t('{0}: configure uma URL HTTP(S) absoluta no ambiente.', label));
    let key = serverKeys.get(baseUrl);
    if (!key) {
      key = serverKeys.size ? 'base_url_' + (serverKeys.size + 1) : 'base_url';
      serverKeys.set(baseUrl, key);
      environment.variables.push(pair(key, baseUrl));
    }
    return '{{' + key + '}}';
  }

  function secret(scheme: string, field: string) {
    const id = scheme + ':' + field;
    let key = secretKeys.get(id);
    if (!key) {
      key = 'openapi_' + scheme.replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + field;
      while (environment.variables.some((row) => row.key === key)) key += '_';
      secretKeys.set(id, key);
      environment.variables.push({ ...pair(key, ''), secret: true });
    }
    return '{{' + key + '}}';
  }

  const schemes = object(object(document.components).securitySchemes);
  function auth(security: unknown, label: string) {
    const alternatives = list(security);
    const first = Object.keys(object(alternatives[0]));
    const scheme = first[0];
    const config = scheme && first.length === 1 ? resolve(schemes[scheme], label) : {};
    const http = str(config.scheme).toLowerCase();
    if (alternatives.length > 1)
      issues.add(t('{0}: foi importada apenas a primeira opção de autenticação.', label));
    if (!scheme) return emptyAuth();
    issues.add(t('{0}: configure a autenticação no Fedexe antes de enviar.', label));
    if (config.type === 'http' && http === 'bearer')
      return { ...emptyAuth(), type: 'bearer' as const, token: secret(scheme, 'token') };
    if (config.type === 'http' && http === 'basic')
      return {
        ...emptyAuth(),
        type: 'basic' as const,
        username: secret(scheme, 'username'),
        password: secret(scheme, 'password'),
      };
    if (
      config.type === 'apiKey' &&
      str(config.name) &&
      (config.in === 'header' || config.in === 'query')
    )
      return {
        ...emptyAuth(),
        type: 'api-key' as const,
        key: str(config.name),
        placement: config.in as 'header' | 'query',
        value: secret(scheme, 'key'),
      };
    issues.add(t('{0}: o esquema de autenticação exige configuração manual.', label));
    return emptyAuth();
  }

  function example(media: Record<string, unknown>, label: string) {
    if (Object.hasOwn(media, 'example')) return media.example;
    const first = resolve(Object.values(object(media.examples))[0], label);
    if (Object.hasOwn(first, 'value')) return first.value;
    const schema = resolve(media.schema, label);
    if (Object.hasOwn(schema, 'example')) return schema.example;
    return list(schema.examples)[0] ?? schema.default;
  }

  function body(request: Collection['requests'][number], raw: unknown, label: string) {
    if (raw === undefined) return;
    const content = Object.entries(object(resolve(raw, label).content));
    const supported =
      content.find(([type]) => type === 'application/json') ??
      content.find(([type]) => /\+json$|^text\/|^application\/x-www-form-urlencoded$/.test(type));
    if (supported) {
      const [type, media] = supported;
      const value = example(object(media), label);
      if (
        type === 'application/x-www-form-urlencoded' &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const fields = Object.entries(value);
        if (fields.every(([, entry]) => scalar(entry) !== undefined)) {
          request.bodyType = 'urlencoded';
          request.form = fields.map(([key, entry]) => pair(key, scalar(entry) ?? ''));
        }
      } else if (type.startsWith('text/') && typeof value === 'string') {
        request.bodyType = 'text';
        request.body = value;
      } else if ((type === 'application/json' || type.endsWith('+json')) && value !== undefined) {
        request.bodyType = 'json';
        request.body = JSON.stringify(value, null, 2);
      }
      if (
        request.bodyType !== 'none' &&
        !request.headers.some((row) => row.key.toLowerCase() === 'content-type')
      )
        request.headers.push(pair('Content-Type', type));
    }
    if (request.bodyType === 'none' || content.length > 1)
      issues.add(t('{0}: revise os formatos e exemplos do corpo da requisição.', label));
  }

  collection.auth = auth(document.security, name);
  for (const [path, raw] of Object.entries(object(document.paths))) {
    if (!path.startsWith('/')) continue;
    const pathItem = resolve(raw, path);
    if (pathItem.trace || pathItem.query) issues.add(t('{0}: método HTTP sem suporte.', path));
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method)) continue;
      const op = object(operation);
      const label = method.toUpperCase() + ' ' + path;
      const folder =
        list(op.tags).find((tag): tag is string => typeof tag === 'string' && !!tag.trim()) ?? '';
      if (folder && !collection.folders.includes(folder)) collection.folders.push(folder);
      if (list(op.tags).length > 1)
        issues.add(t('{0}: a requisição foi agrupada pela primeira tag.', label));
      const request = newRequest(folder);
      request.tests = [];
      request.headers = [];
      request.name = str(op.summary) || str(op.operationId) || label;
      request.description = str(op.description);
      request.method = method.toUpperCase() as Method;
      const servers = [op.servers, pathItem.servers, document.servers].map(list);
      const base = serverVariable(servers.find((items) => items.length) ?? [], label);
      if (Object.hasOwn(op, 'security')) request.auth = auth(op.security, label);
      const params = new Map<string, Record<string, unknown>>();
      for (const entry of [...list(pathItem.parameters), ...list(op.parameters)]) {
        const parameter = resolve(entry, label);
        if (str(parameter.name)) {
          const key = str(parameter.name);
          params.set(
            str(parameter.in) + ':' + (parameter.in === 'header' ? key.toLowerCase() : key),
            parameter,
          );
        }
      }
      const pathRows = new Map<string, ReturnType<typeof pair>>();
      for (const param of params.values()) {
        const key = str(param.name);
        const value = scalar(example(param, label));
        const defaultStyle = param.in === 'query' ? 'form' : 'simple';
        const schemaType = resolve(param.schema, label).type;
        const manual =
          (param.style !== undefined && param.style !== defaultStyle) ||
          param.allowReserved === true ||
          param.content !== undefined ||
          schemaType === 'array' ||
          schemaType === 'object';
        const row = pair(
          key,
          manual ? '' : (value ?? ''),
          !manual && (value !== undefined || param.required === true),
        );
        if (param.in === 'path') pathRows.set(key, { ...row, enabled: true });
        else if (param.in === 'query') request.params.push(row);
        else if (param.in === 'header') {
          if (/^(accept|content-type|authorization)$/i.test(key)) continue;
          request.headers.push(row);
        }
        if (
          manual ||
          !['path', 'query', 'header'].includes(str(param.in)) ||
          (value === undefined && param.required === true && param.in !== 'path')
        )
          issues.add(t('{0}: revise o parâmetro {1}.', label, key));
      }
      request.pathParams = [];
      const placeholders = new Map<string, string>();
      const originalNames = new Set(
        Array.from(path.matchAll(/\{([^{}]+)\}/g), (match) => match[1]),
      );
      request.url =
        base +
        path.replace(/\{([^{}]+)\}/g, (_, key: string) => {
          let resolved = placeholders.get(key);
          if (!resolved) {
            resolved = key;
            if (!/^[\w-]+$/.test(key)) {
              resolved = key.replace(/[^\w-]/g, '_');
              while (originalNames.has(resolved)) resolved += '_';
              originalNames.add(resolved);
            }
            placeholders.set(key, resolved);
            const row = pathRows.get(key) ?? pair(key, '');
            if (!row.value) issues.add(t('{0}: revise o parâmetro {1}.', label, key));
            request.pathParams?.push({ ...row, key: resolved });
          }
          return '{' + resolved + '}';
        });
      if (Object.keys(object(op.callbacks)).length)
        issues.add(t('Revise webhooks, callbacks ou operações que não puderam ser importadas.'));
      body(request, op.requestBody, label);
      collection.requests.push(request);
    }
  }
  if (
    Object.keys(object(document.webhooks)).length ||
    Object.keys(object(document.components)).includes('callbacks') ||
    collection.requests.length === 0
  )
    issues.add(t('Revise webhooks, callbacks ou operações que não puderam ser importadas.'));
  if (!collection.requests.length)
    throw new Error(t('A especificação não contém operações HTTP compatíveis.'));
  return { collection, environment, issues: [...issues] };
}
