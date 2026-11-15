import { t } from './i18n';
import { uid } from './utils';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type View =
  | 'collections'
  | 'environments'
  | 'runner'
  | 'history'
  | 'console'
  | 'settings'
  | 'drive'
  | 'notifications';
export type RunScope = 'collection' | 'folder' | 'selection';

export function requestsForRun(
  collection: Collection | undefined,
  scope: RunScope,
  folder: string,
  selection: string[],
): RequestItem[] {
  if (!collection) return [];
  if (scope === 'folder')
    return collection.folders.includes(folder)
      ? collection.requests.filter((request) => request.folder === folder)
      : [];
  if (scope === 'selection') {
    const selected = new Set(selection);
    return collection.requests.filter((request) => selected.has(request.id));
  }
  return collection.requests;
}
export type RedirectPolicy = 'none' | 'same_origin';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 600_000;

function validTimeout(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_TIMEOUT_MS;
}
export type Pair = { id: string; key: string; value: string; enabled: boolean; secret?: boolean };
export type MultipartRow = Pair & { kind: 'field' | 'file' };
type MultipartPart =
  { kind: 'field'; name: string; value: string } | { kind: 'file'; name: string; path: string };
export type OAuthProvider = {
  authorization_url: string;
  token_url: string;
  client_id: string;
  scope: string;
};
export type OAuthConfig = OAuthProvider & {
  grant: 'pkce' | 'client_credentials';
  client_secret: string;
};
type OAuthRequest =
  | { grant: 'pkce'; provider: OAuthProvider }
  | {
      grant: 'client_credentials';
      resolved?: boolean;
      token_url: string;
      client_id: string;
      client_secret: string;
      scope: string;
    };

export type Auth = {
  type: 'inherit' | 'none' | 'bearer' | 'basic' | 'api-key' | 'oauth2';
  oauth?: OAuthConfig;
  token: string;
  username: string;
  password: string;
  key: string;
  value: string;
  placement: 'header' | 'query';
};
export type Test =
  | { type: 'status'; equals: number }
  | { type: 'header'; name: string; equals?: string }
  | { type: 'json'; pointer: string; equals: unknown };
export type RequestItem = {
  timeoutMs?: number;
  redirectPolicy?: RedirectPolicy;
  id: string;
  name: string;
  folder: string;
  method: Method;
  url: string;
  description: string;
  params: Pair[];
  pathParams?: Pair[];
  headers: Pair[];
  bodyType: 'none' | 'json' | 'text' | 'urlencoded' | 'multipart' | 'binary';
  body: string;
  form: Pair[];
  multipart?: MultipartRow[];
  binaryFile?: string;
  auth: Auth;
  tests: Test[];
  extract: Record<string, string>;
};
export type Collection = {
  id: string;
  name: string;
  description: string;
  folders: string[];
  variables: Pair[];
  auth: Auth;
  requests: RequestItem[];
};
export type Environment = { id: string; name: string; color: string; variables: Pair[] };

export function isEnvironment(value: unknown): value is Environment {
  if (!value || typeof value !== 'object') return false;
  const env = value as Environment;
  return (
    typeof env.id === 'string' &&
    typeof env.name === 'string' &&
    typeof env.color === 'string' &&
    validPairs(env.variables)
  );
}

export function safeEnvironment(
  environment: Environment,
  collections: Collection[] = [],
): Environment {
  const references = workspaceCredentialReferences(collections);
  return {
    ...environment,
    variables: environment.variables.map((row) =>
      privateVariable(row, references) ? { ...row, value: '', secret: true } : row,
    ),
  };
}
export type HttpRequest = {
  timeout_ms?: number;
  redirect_policy?: RedirectPolicy;
  method: string;
  url: string;
  headers: [string, string][] | Record<string, string>;
  body: string | null;
  query?: [string, string][];
  path_params?: [string, string][];
  form?: [string, string][];
  multipart?: MultipartPart[];
  binary_file?: string;
  basic_auth?: [string, string];
  oauth?: OAuthRequest;
  validate_json?: boolean;
  console_masks?: { values: string[]; headers: string[]; query: string[]; templates: string[] };
};
export type HttpResponse = {
  status: number;
  duration_ms: number;
  headers: [string, string][];
  preview: string;
  truncated: boolean;
  size_bytes?: number;
  body_id?: string | null;
};
export type HistoryItem = {
  id: string;
  name: string;
  method: Method;
  url: string;
  status: number | null;
  duration: number;
  date: string;
  requestId: string;
  collectionId: string;
  error?: string;
};
export type RunFailureReason =
  'status' | 'header' | 'json' | 'extraction' | 'preparation' | 'transport';
export type RunRow = {
  name: string;
  status: number | null;
  http_ms: number;
  validation_ms: number;
  checks_passed: number;
  failures: string[];
  failure_reasons: RunFailureReason[];
};
export type RunResult = {
  duration_ms: number;
  results: RunRow[];
  outcome: 'completed' | 'cancelled' | 'stopped_on_failure';
};
export type NativeCollection = {
  stop_on_failure?: boolean;
  variables: Record<string, string>;
  requests: ({
    name: string;
    tests: Test[];
    extract: Record<string, string>;
  } & (
    | { request: HttpRequest; preparation_error?: never }
    | { request?: never; preparation_error: string }
  ))[];
};
export type CredentialAddress = {
  scope: 'environment' | 'collection' | 'revision';
  environment: string;
  variable: string;
};

export type Workspace = {
  version: 1;
  credentialSlots?: string[];
  credentialRevisions?: Record<string, string>;
  retiredCredentials?: CredentialAddress[];
  collections: Collection[];
  environments: Environment[];
  activeEnvironment: string;
  history: HistoryItem[];
  settings: {
    theme: 'light' | 'dark' | 'system';
    compact: boolean;
    wrap: boolean;
    workspaceName: string;
  };
};

export const emptyAuth = (): Auth => ({
  type: 'none',
  token: '',
  username: '',
  password: '',
  key: 'X-API-Key',
  value: '',
  placement: 'header',
});
export const pair = (key = '', value = '', enabled = true): Pair => ({
  id: uid(),
  key,
  value,
  enabled,
});
export const newRequest = (folder = ''): RequestItem => ({
  id: uid(),
  name: t('Nova requisição'),
  folder,
  method: 'GET',
  url: '{{base_url}}/',
  description: '',
  params: [],
  headers: [pair('Accept', 'application/json')],
  bodyType: 'none',
  body: '',
  form: [],
  auth: { ...emptyAuth(), type: 'inherit' },
  tests: [{ type: 'status', equals: 200 }],
  extract: {},
});

export function createWorkspace(): Workspace {
  const request = (
    name: string,
    method: Method,
    url: string,
    folder: string,
    extra: Partial<RequestItem> = {},
  ): RequestItem => ({ ...newRequest(folder), name, method, url: `{{base_url}}${url}`, ...extra });
  return {
    version: 1,
    collections: [
      {
        id: 'acme',
        name: 'Acme API',
        description: t('Um lugar para construir, explorar e testar sua API.'),
        folders: [t('Autenticação'), t('Usuários'), t('Sistema')],
        variables: [pair('base_url', 'http://127.0.0.1:8787')],
        auth: emptyAuth(),
        requests: [
          request(t('Obter token'), 'GET', '/token', t('Autenticação'), {
            extract: { token: '/token' },
          }),
          request(t('Listar usuários'), 'GET', '/users', t('Usuários'), {
            id: 'list-users',
            description: t('Retorna os usuários do workspace com paginação.'),
            params: [pair('page', '1'), pair('limit', '10'), pair('search', '', false)],
            tests: [
              { type: 'status', equals: 200 },
              { type: 'header', name: 'content-type' },
              { type: 'json', pointer: '/success', equals: true },
            ],
          }),
          request(t('Buscar usuário'), 'GET', '/users/1', t('Usuários')),
          request(t('Criar usuário'), 'POST', '/users', t('Usuários'), {
            bodyType: 'json',
            body: JSON.stringify(
              { name: 'Alex Morgan', email: 'alex@acme.dev', role: 'developer' },
              null,
              2,
            ),
            tests: [{ type: 'status', equals: 201 }],
          }),
          request(t('Atualizar usuário'), 'PATCH', '/users/1', t('Usuários'), {
            bodyType: 'json',
            body: '{\n  "name": "Alex Morgan"\n}',
          }),
          request(t('Excluir usuário'), 'DELETE', '/users/1', t('Usuários'), {
            tests: [{ type: 'status', equals: 204 }],
          }),
          request(t('Verificar autenticação'), 'GET', '/private', t('Sistema'), {
            auth: { ...emptyAuth(), type: 'bearer', token: '{{token}}' },
          }),
          request(t('Status da API'), 'GET', '/health', t('Sistema')),
        ],
      },
    ],
    environments: [
      {
        id: 'local',
        name: 'Local',
        color: 'green',
        variables: [pair('base_url', 'http://127.0.0.1:8787')],
      },
      {
        id: 'dev',
        name: t('Desenvolvimento'),
        color: 'purple',
        variables: [pair('base_url', 'http://localhost:3000')],
      },
      {
        id: 'staging',
        name: t('Homologação'),
        color: 'amber',
        variables: [pair('base_url', 'https://staging.example.com')],
      },
    ],
    activeEnvironment: 'local',
    history: [],
    settings: { theme: 'light', compact: false, wrap: true, workspaceName: t('Meu workspace') },
  };
}

export const STORAGE_KEY = 'fedexe.workspace.v1';
export function loadWorkspace(raw: string | null): Workspace {
  if (raw === null) return createWorkspace();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (!isWorkspace(parsed))
    throw new Error(
      t(
        'O workspace salvo usa um formato inválido ou uma versão não suportada. Seus dados foram preservados.',
      ),
    );
  return parsed;
}

export function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== 'object') return false;
  const data = value as Workspace;
  return (
    data.version === 1 &&
    (data.credentialSlots === undefined ||
      (Array.isArray(data.credentialSlots) &&
        data.credentialSlots.every((key) => typeof key === 'string'))) &&
    (data.credentialRevisions === undefined ||
      (!!data.credentialRevisions &&
        typeof data.credentialRevisions === 'object' &&
        !Array.isArray(data.credentialRevisions) &&
        Object.values(data.credentialRevisions).every(
          (revision) => typeof revision === 'string',
        ))) &&
    (data.retiredCredentials === undefined ||
      (Array.isArray(data.retiredCredentials) &&
        data.retiredCredentials.every(
          (address) =>
            address &&
            ['environment', 'collection', 'revision'].includes(address.scope) &&
            typeof address.environment === 'string' &&
            typeof address.variable === 'string',
        ))) &&
    Array.isArray(data.collections) &&
    data.collections.every(validCollection) &&
    Array.isArray(data.environments) &&
    data.environments.every(
      (env) =>
        !!env &&
        typeof env.id === 'string' &&
        typeof env.name === 'string' &&
        typeof env.color === 'string' &&
        validPairs(env.variables),
    ) &&
    typeof data.activeEnvironment === 'string' &&
    Array.isArray(data.history) &&
    data.history.every(
      (row) =>
        !!row &&
        typeof row.id === 'string' &&
        typeof row.date === 'string' &&
        typeof row.name === 'string' &&
        typeof row.url === 'string' &&
        typeof row.method === 'string' &&
        typeof row.duration === 'number' &&
        (row.status === null || typeof row.status === 'number') &&
        typeof row.collectionId === 'string' &&
        typeof row.requestId === 'string',
    ) &&
    !!data.settings &&
    ['light', 'dark', 'system'].includes(data.settings.theme) &&
    typeof data.settings.workspaceName === 'string' &&
    typeof data.settings.compact === 'boolean' &&
    typeof data.settings.wrap === 'boolean'
  );
}
function validPairs(value: unknown): value is Pair[] {
  return (
    Array.isArray(value) &&
    value.every(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.key === 'string' &&
        typeof p.value === 'string' &&
        typeof p.enabled === 'boolean' &&
        (p.secret === undefined || typeof p.secret === 'boolean'),
    )
  );
}
const oauthFields = [
  'authorization_url',
  'token_url',
  'client_id',
  'scope',
  'client_secret',
] as const;

function validOAuth(config: OAuthConfig | undefined) {
  return (
    !!config &&
    ['pkce', 'client_credentials'].includes(config.grant) &&
    oauthFields.every((key) => typeof config[key] === 'string') &&
    Object.keys(config).length === oauthFields.length + 1
  );
}

function validAuth(value: unknown): value is Auth {
  const a = value as Auth;
  return (
    !!a &&
    ['none', 'inherit', 'basic', 'bearer', 'api-key', 'oauth2'].includes(a.type) &&
    (a.oauth === undefined ? a.type !== 'oauth2' : validOAuth(a.oauth)) &&
    ['token', 'username', 'password', 'key', 'value'].every(
      (key) => typeof a[key as keyof Auth] === 'string',
    ) &&
    ['header', 'query'].includes(a.placement)
  );
}
export function validCollection(value: unknown): value is Collection {
  const c = value as Collection;
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.description === 'string' &&
    Array.isArray(c.folders) &&
    c.folders.every((f) => typeof f === 'string') &&
    validPairs(c.variables) &&
    validAuth(c.auth) &&
    Array.isArray(c.requests) &&
    c.requests.every(
      (r) =>
        r &&
        typeof r.id === 'string' &&
        typeof r.name === 'string' &&
        typeof r.folder === 'string' &&
        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(r.method) &&
        typeof r.url === 'string' &&
        typeof r.description === 'string' &&
        validPairs(r.params) &&
        (r.pathParams === undefined || validPairs(r.pathParams)) &&
        validPairs(r.headers) &&
        (r.timeoutMs === undefined || validTimeout(r.timeoutMs)) &&
        (r.redirectPolicy === undefined || ['none', 'same_origin'].includes(r.redirectPolicy)) &&
        validPairs(r.form) &&
        (r.multipart === undefined ||
          (validPairs(r.multipart) &&
            r.multipart.every((row) => ['field', 'file'].includes(row.kind)))) &&
        (r.binaryFile === undefined || typeof r.binaryFile === 'string') &&
        validAuth(r.auth) &&
        ['none', 'json', 'text', 'urlencoded', 'multipart', 'binary'].includes(r.bodyType) &&
        typeof r.body === 'string' &&
        Array.isArray(r.tests) &&
        r.tests.every(
          (t) =>
            t &&
            (t.type === 'status'
              ? typeof t.equals === 'number'
              : t.type === 'header'
                ? typeof t.name === 'string' &&
                  (t.equals === undefined || typeof t.equals === 'string')
                : t.type === 'json' && typeof t.pointer === 'string' && 'equals' in t),
        ) &&
        !!r.extract &&
        typeof r.extract === 'object' &&
        Object.values(r.extract).every((v) => typeof v === 'string'),
    )
  );
}
const credentialHeader =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i;
const credentialParameter =
  /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|x[_-]?api[_-]?key|api[_-]?key|password|client[_-]?secret)$/i;
function privateVariable(row: Pair, references: Set<string>) {
  return row.secret || credentialParameter.test(row.key.trim()) || references.has(row.key);
}

const variableReference = /^\{\{[^{}]+\}\}$/;

export function redactUrlCredentials(url: string) {
  const withoutUserInfo = url.replace(/^(\s*https?:\/\/)[^/?#]*@/i, '$1');
  const queryStart = withoutUserInfo.indexOf('?');
  const hash = withoutUserInfo.indexOf('#');
  if (queryStart < 0 || (hash >= 0 && hash < queryStart)) return withoutUserInfo;
  const queryEnd = hash < 0 ? withoutUserInfo.length : hash;
  const query = withoutUserInfo.slice(queryStart + 1, queryEnd).split('&');
  const sanitized = query.map((part) => {
    const [key, value] = new URLSearchParams(part).entries().next().value ?? [];
    return key && value && credentialParameter.test(key) && !variableReference.test(value)
      ? part.slice(0, part.indexOf('=') + 1)
      : part;
  });
  return (
    withoutUserInfo.slice(0, queryStart + 1) + sanitized.join('&') + withoutUserInfo.slice(queryEnd)
  );
}

type CredentialValue = (field: string[], value: string, publicValue: string) => string;
const publicCredential: CredentialValue = (_field, _value, publicValue) => publicValue;

function mapAuth(auth: Auth, credential: CredentialValue, keepReferences = true): Auth {
  const result = { ...auth };
  if (auth.oauth) {
    const { client_secret, token_url, authorization_url } = auth.oauth;
    result.oauth = {
      ...auth.oauth,
      client_secret:
        keepReferences && variableReference.test(client_secret)
          ? client_secret
          : credential(['auth', 'oauth', 'client_secret'], client_secret, ''),
      token_url: credential(
        ['auth', 'oauth', 'token_url'],
        token_url,
        redactUrlCredentials(token_url),
      ),
      authorization_url: credential(
        ['auth', 'oauth', 'authorization_url'],
        authorization_url,
        redactUrlCredentials(authorization_url),
      ),
    };
  }
  for (const field of ['token', 'username', 'password', 'value'] as const) {
    if (!keepReferences || !variableReference.test(auth[field]))
      result[field] = credential(['auth', field], auth[field], '');
  }
  return result;
}

function mapPairs<T extends Pair>(
  rows: T[],
  field: string,
  credential: CredentialValue,
  sensitiveName?: RegExp,
  keepReferences = true,
): T[] {
  return rows.map((row) =>
    (row.secret || sensitiveName?.test(row.key.trim())) &&
    (!keepReferences ||
      (!variableReference.test(row.value) &&
        !(field === 'headers' && /^Bearer \{\{[^{}]+\}\}$/i.test(row.value))))
      ? { ...row, value: credential([field, row.id], row.value, '') }
      : row,
  );
}

function mapRequest(
  request: RequestItem,
  credential: CredentialValue,
  keepReferences = true,
): RequestItem {
  return {
    ...request,
    url: credential(['url'], request.url, redactUrlCredentials(request.url)),
    auth: mapAuth(request.auth, credential, keepReferences),
    headers: mapPairs(request.headers, 'headers', credential, credentialHeader, keepReferences),
    params: mapPairs(request.params, 'params', credential, credentialParameter, keepReferences),
    form: mapPairs(request.form, 'form', credential, credentialParameter, keepReferences),
    ...(request.pathParams && {
      pathParams: mapPairs(request.pathParams, 'pathParams', credential, undefined, keepReferences),
    }),
    ...(request.multipart && {
      multipart: mapPairs(
        request.multipart,
        'multipart',
        credential,
        credentialParameter,
        keepReferences,
      ),
    }),
  };
}

function collectCredentialReferences(collection: Collection, references: Set<string>) {
  const collect: CredentialValue = (field, value) => {
    if (field[0] !== 'url') {
      for (const [, name] of value.matchAll(/\{\{([^{}]+)\}\}/g)) references.add(name.trim());
    }
    return value;
  };
  mapAuth(collection.auth, collect, false);
  for (const request of collection.requests) mapRequest(syncUrl(request), collect, false);
  return references;
}

function workspaceCredentialReferences(collections: Collection[]) {
  const references = new Set<string>();
  for (const collection of collections) collectCredentialReferences(collection, references);
  return references;
}

function mapCollection(collection: Collection, credential: CredentialValue): Collection {
  const references = collectCredentialReferences(collection, new Set());
  return {
    ...collection,
    auth: mapAuth(collection.auth, credential),
    variables: collection.variables.map((row) =>
      privateVariable(row, references)
        ? { ...row, value: credential(['variables', row.id], row.value, ''), secret: true }
        : row,
    ),
    requests: collection.requests.map((request) =>
      mapRequest(request, (field, value, publicValue) =>
        credential(['request', request.id, ...field], value, publicValue),
      ),
    ),
  };
}

export function mapWorkspaceCredentials(
  workspace: Workspace,
  credential: (
    scope: 'environment' | 'collection',
    owner: string,
    field: string[],
    value: string,
    publicValue: string,
  ) => string,
): Workspace {
  const {
    credentialSlots: _slots,
    credentialRevisions: _revisions,
    retiredCredentials: _retired,
    ...data
  } = workspace;
  const references = workspaceCredentialReferences(workspace.collections);
  return {
    ...data,
    environments: workspace.environments.map((environment) => ({
      ...environment,
      variables: environment.variables.map((row) =>
        privateVariable(row, references)
          ? {
              ...row,
              value: credential('environment', environment.id, [row.id], row.value, ''),
              secret: true,
            }
          : row,
      ),
    })),
    collections: workspace.collections.map((collection) =>
      mapCollection(collection, (field, value, publicValue) =>
        credential('collection', collection.id, field, value, publicValue),
      ),
    ),
    history: workspace.history.map((row) => ({ ...row, url: redactUrlCredentials(row.url) })),
  };
}

export function compileRequestSnippet(
  request: RequestItem,
  collection: Collection,
  environment?: Environment,
) {
  if (effectiveAuth(request, collection).type === 'oauth2')
    throw new Error(t('O snippet não inclui a autenticação OAuth 2.0. Exporte a coleção.'));
  const mask = '<segredo>';
  const references = collectCredentialReferences({ ...collection, requests: [request] }, new Set());
  const maskCredential: CredentialValue = (_field, value) => (value ? mask : '');
  const maskVariables = (rows: Pair[]) =>
    rows.map((row) =>
      privateVariable(row, references) && row.value ? { ...row, value: mask } : row,
    );
  const safeCollection = {
    ...collection,
    auth: mapAuth(collection.auth, maskCredential, false),
    variables: maskVariables(collection.variables),
  };
  const safeEnvironment = environment && {
    ...environment,
    variables: maskVariables(environment.variables),
  };
  const safeRequest = mapRequest(
    syncUrl(request),
    (field, value, publicValue) =>
      field[0] === 'url' ? publicValue : maskCredential(field, value, publicValue),
    false,
  );
  return compileRequest(safeRequest, safeCollection, variablesFor(safeCollection, safeEnvironment));
}

export function exportableRequest(request: RequestItem): RequestItem {
  return mapRequest(request, publicCredential);
}

export function exportableCollection(collection: Collection): Collection {
  return mapCollection(collection, publicCredential);
}

export function exportableWorkspace(workspace: Workspace): Workspace {
  return mapWorkspaceCredentials(
    workspace,
    (_scope, _owner, _field, _value, publicValue) => publicValue,
  );
}

export function driveBackupSnapshot(workspace: Workspace): Workspace {
  const { collections, environments, activeEnvironment, settings } = exportableWorkspace(workspace);
  return {
    version: 1,
    collections: collections.map((collection) => ({
      ...collection,
      requests: collection.requests.map((request) => ({
        ...request,
        binaryFile: undefined,
        multipart: request.multipart?.map((row) =>
          row.kind === 'file' ? { ...row, value: '' } : row,
        ),
      })),
    })),
    environments,
    activeEnvironment,
    settings,
    history: [],
  };
}

export function redactSecrets(message: string, environment?: Environment): string {
  const secrets =
    environment?.variables
      .filter(({ secret, value }) => secret && value)
      .flatMap(({ value }) => {
        try {
          return [value, encodeURIComponent(value)];
        } catch {
          return [value];
        }
      })
      .sort((left, right) => right.length - left.length) ?? [];
  return secrets.reduce((text, secret) => text.replaceAll(secret, '[segredo]'), message);
}
function resolvedVariables(collection: Collection, environment?: Environment) {
  const variables = new Map<
    string,
    { value: string; source: 'collection' | 'environment'; secret?: boolean }
  >();
  const groups = [
    ['collection', collection.variables],
    ['environment', environment?.variables ?? []],
  ] as const;
  for (const [source, rows] of groups) {
    for (const row of rows) {
      if (!row.enabled || !row.key) continue;
      if (row.secret && !row.value) variables.delete(row.key);
      else variables.set(row.key, { value: row.value, source, secret: row.secret });
    }
  }
  return variables;
}

export function variablesFor(collection: Collection, environment?: Environment) {
  const variables: Record<string, string> = Object.create(null);
  for (const [name, { value }] of resolvedVariables(collection, environment))
    variables[name] = value;
  return variables;
}

export function requestVariables(
  item: RequestItem,
  collection: Collection,
  environment?: Environment,
) {
  const request = compileRequest(item, collection, {}, false, true);
  const fields = [
    request.url,
    ...headerEntries(request.headers).map(([, value]) => value),
    ...(request.basic_auth ?? []),
    ...(request.oauth?.grant === 'client_credentials'
      ? [
          request.oauth.token_url,
          request.oauth.client_id,
          request.oauth.client_secret,
          request.oauth.scope,
        ]
      : []),
    ...(request.query ?? []).flat(),
    ...(request.path_params ?? []).map(([, value]) => value),
    ...(request.form ?? []).flat(),
    ...(request.multipart ?? []).flatMap((part) =>
      part.kind === 'field' ? [part.name, part.value] : [part.name],
    ),
    ...(request.body !== null && !request.form ? [request.body] : []),
  ];
  const names = new Set<string>();
  let unclosed = false;
  for (const field of fields) {
    for (const match of field.matchAll(/\{\{([\s\S]*?)\}\}|\{\{/g)) {
      if (match[1] === undefined) unclosed = true;
      else names.add(match[1].trim());
    }
  }
  const resolved = resolvedVariables(collection, environment);
  return {
    unclosed,
    variables: [...names].map((name) => ({ name, source: resolved.get(name)?.source })),
  };
}
export class RequestResolutionError extends Error {}

export function expand(value: string, vars: Record<string, string>) {
  let result = '';
  let rest = value;
  while (rest.includes('{{')) {
    const start = rest.indexOf('{{');
    const end = rest.indexOf('}}', start + 2);
    if (end < 0) throw new RequestResolutionError(t('Variável sem fechamento. Use {{nome}}.'));
    const key = rest.slice(start + 2, end).trim();
    if (!Object.hasOwn(vars, key))
      throw new RequestResolutionError(
        t('Variável ausente: {0}. Configure o valor no ambiente ativo.', key),
      );
    result += rest.slice(0, start) + vars[key];
    rest = rest.slice(end + 2);
  }
  return result + rest;
}
export function effectiveAuth(item: RequestItem, collection: Collection): Auth {
  return item.auth.type === 'inherit' ? collection.auth : item.auth;
}

export function authHeaderConflict(item: RequestItem, collection: Collection): string | undefined {
  const auth = effectiveAuth(item, collection);
  const name = ['bearer', 'basic', 'oauth2'].includes(auth.type)
    ? 'Authorization'
    : auth.type === 'api-key' && auth.placement === 'header'
      ? auth.key.trim()
      : '';
  if (
    name &&
    item.headers.some((row) => row.enabled && row.key.trim().toLowerCase() === name.toLowerCase())
  )
    return t('Header em conflito: {0}. Desative a linha manual ou mude a autorização.', name);
}

export function headerEntries(headers: HttpRequest['headers']): [string, string][] {
  return Array.isArray(headers) ? headers : Object.entries(headers);
}

export function generatedHeaders(item: RequestItem, collection: Collection) {
  const auth = effectiveAuth(item, collection);
  const headers: { name: string; value: string; secret: boolean; source: string }[] = [];
  if (['basic', 'bearer', 'oauth2'].includes(auth.type))
    headers.push({ name: 'Authorization', value: '', secret: true, source: t('Autorização') });
  if (auth.type === 'api-key' && auth.placement === 'header' && auth.key.trim())
    headers.push({ name: auth.key.trim(), value: '', secret: true, source: t('Autorização') });
  if (
    !item.headers.some((row) => row.enabled && row.key.trim().toLowerCase() === 'content-type') &&
    !headers.some(({ name }) => name.toLowerCase() === 'content-type') &&
    ['json', 'urlencoded', 'multipart', 'binary'].includes(item.bodyType)
  )
    headers.push({
      name: 'Content-Type',
      value: {
        json: 'application/json',
        urlencoded: 'application/x-www-form-urlencoded',
        multipart: t('multipart/form-data (boundary automático)'),
        binary: 'application/octet-stream',
      }[item.bodyType as 'json' | 'urlencoded' | 'multipart' | 'binary'],
      secret: false,
      source: t('Corpo'),
    });
  return headers;
}

export function isSecretHeader(row: Pair, collection: Collection, environment?: Environment) {
  if (row.secret || credentialHeader.test(row.key.trim())) return true;
  const variables = resolvedVariables(collection, environment);
  return [...row.value.matchAll(/\{\{([\s\S]*?)\}\}/g)].some(
    ([, name]) => variables.get(name.trim())?.secret,
  );
}

export function addConsoleMasks(
  request: HttpRequest,
  item: RequestItem,
  collection: Collection,
  environment: Environment | undefined,
  variables: Record<string, string>,
  deferred = false,
): HttpRequest {
  const headers: string[] = [];
  const query: string[] = [];
  const credentials: string[] = [];
  for (const header of item.headers) {
    if (header.enabled && isSecretHeader(header, collection, environment)) {
      headers.push(header.key.trim());
      credentials.push(header.value);
    }
  }
  for (const row of [
    ...item.params,
    ...(item.pathParams ?? []),
    ...item.form,
    ...(item.multipart ?? []),
  ]) {
    if (row.enabled && row.secret) credentials.push(row.value);
  }
  const auth = effectiveAuth(item, collection);
  if (auth.type === 'basic') credentials.push(auth.username, auth.password);
  if (auth.type === 'bearer') credentials.push(auth.token);
  if (auth.type === 'api-key') {
    (auth.placement === 'header' ? headers : query).push(auth.key.trim());
    credentials.push(auth.value);
  }
  const values = [...collection.variables, ...(environment?.variables ?? [])]
    .filter((row) => row.enabled && row.secret)
    .map((row) => row.value);
  if (!deferred) {
    for (const template of credentials) {
      try {
        values.push(expand(template, variables));
      } catch {
        // Inactive fields can still refer to variables absent from this environment.
      }
    }
  }
  return {
    ...request,
    console_masks: { values, headers, query, templates: deferred ? credentials : [] },
  };
}

export function compileRequest(
  item: RequestItem,
  collection: Collection,
  vars: Record<string, string>,
  resolve = true,
  defer = false,
): HttpRequest {
  item = syncUrl(item);
  if (item.timeoutMs !== undefined && !validTimeout(item.timeoutMs))
    throw new Error(t('O timeout deve ficar entre 1 e 600.000 ms.'));
  const conflict = authHeaderConflict(item, collection);
  if (conflict) throw new Error(conflict);
  const expandValue = (value: string) => (resolve ? expand(value, vars) : value);
  const hasFileBody = item.bodyType === 'multipart' || item.bodyType === 'binary';
  const pathParams: [string, string][] = (item.pathParams ?? [])
    .filter((row) => row.enabled && row.key)
    .map(({ key, value }) => [key, value]);
  let url = defer
    ? item.url.trim()
    : resolvePath(item.url.trim(), pathParams, resolve ? vars : undefined);
  const active = item.params.filter((p) => p.enabled && p.key);
  const query: [string, string][] = active.map((p) => [p.key, p.value]);
  const headers: [string, string][] = [];
  const addHeader = (key: string, value: string) => headers.push([key, expandValue(value)]);
  item.headers
    .filter((p) => p.enabled && p.key.trim())
    .forEach((p) => addHeader(p.key.trim(), p.value));
  const auth = effectiveAuth(item, collection);
  let oauth: OAuthRequest | undefined;
  if (auth.type === 'oauth2') {
    if (!auth.oauth) throw new Error(t('Configure a autorização OAuth 2.0.'));
    const { grant, authorization_url, token_url, client_id, client_secret, scope } = auth.oauth;
    oauth =
      grant === 'pkce'
        ? { grant, provider: { authorization_url, token_url, client_id, scope } }
        : {
            grant,
            ...(resolve && { resolved: true }),
            token_url: expandValue(token_url),
            client_id: expandValue(client_id),
            client_secret: expandValue(client_secret),
            scope: expandValue(scope),
          };
  }
  if (auth.type === 'bearer') addHeader('Authorization', `Bearer ${auth.token}`);
  if (auth.type === 'api-key') {
    const key = auth.key.trim();
    if (!key) throw new Error(t('Informe o nome da chave da API.'));
    if (auth.placement === 'header') addHeader(key, auth.value);
    else query.push([key, auth.value]);
  }
  const hasHeader = (name: string) => headers.some(([key]) => key.toLowerCase() === name);
  if (hasFileBody && (hasHeader('content-length') || hasHeader('transfer-encoding')))
    throw new Error(t('Remova Content-Length e Transfer-Encoding manuais deste corpo.'));
  if (item.bodyType === 'multipart' && hasHeader('content-type'))
    throw new Error(t('Remova o Content-Type manual para gerar o boundary multipart.'));
  const multipart =
    item.bodyType === 'multipart'
      ? (item.multipart ?? [])
          .filter((row) => row.enabled)
          .map((row): MultipartPart => {
            const name = expandValue(row.key.trim());
            if (resolve && !name)
              throw new Error(t('Informe o nome de cada parte multipart ativa.'));
            if (row.kind === 'field') return { kind: 'field', name, value: expandValue(row.value) };
            if (resolve && !row.value)
              throw new Error(t('Selecione o arquivo de cada parte multipart ativa.'));
            return { kind: 'file', name, path: row.value };
          })
      : undefined;
  const binaryFile = item.bodyType === 'binary' ? (item.binaryFile ?? '') : undefined;
  if (resolve && binaryFile === '') throw new Error(t('Selecione um arquivo binário.'));
  if (!defer) url = appendQuery(url, query, resolve ? vars : undefined);
  let body: string | null =
    item.bodyType === 'json' || item.bodyType === 'text' ? expandValue(item.body) : null;
  if (item.bodyType === 'json') {
    if (resolve) {
      try {
        JSON.parse(body || '');
      } catch {
        throw new Error(t('O corpo não contém um JSON válido. Corrija antes de enviar.'));
      }
    }
  }
  if (item.bodyType === 'urlencoded') {
    body = new URLSearchParams(
      item.form
        .filter((p) => p.enabled && p.key)
        .map((p) => [expandValue(p.key), expandValue(p.value)]),
    ).toString();
  }
  for (const header of generatedHeaders(item, collection))
    if (!header.secret && item.bodyType !== 'multipart') headers.push([header.name, header.value]);
  if (auth.type === 'basic' && !defer) {
    const credentials = `${expandValue(auth.username)}:${expandValue(auth.password)}`;
    headers.push([
      'Authorization',
      `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(credentials)))}`,
    ]);
  }
  if (resolve) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error(
        t('Use uma URL HTTP(S) sem credenciais. Configure a autenticação na aba Autorização.'),
      );
  }
  return {
    method: item.method,
    url,
    headers,
    body,
    ...(item.timeoutMs !== undefined ? { timeout_ms: item.timeoutMs } : {}),
    ...(item.redirectPolicy !== undefined ? { redirect_policy: item.redirectPolicy } : {}),
    ...(oauth ? { oauth } : {}),
    ...(multipart !== undefined ? { multipart } : {}),
    ...(binaryFile !== undefined ? { binary_file: binaryFile } : {}),
    ...(defer
      ? {
          query,
          path_params: pathParams,
          ...(auth.type === 'basic'
            ? { basic_auth: [auth.username, auth.password] as [string, string] }
            : {}),
          ...(item.bodyType === 'urlencoded'
            ? {
                form: item.form
                  .filter((p) => p.enabled && p.key)
                  .map((p) => [p.key, p.value] as [string, string]),
              }
            : {}),
          validate_json: item.bodyType === 'json',
        }
      : {}),
  };
}

export function resolveHttpRequest(
  template: HttpRequest,
  variables: Record<string, string>,
): HttpRequest {
  if (template.oauth) throw new Error(t('OAuth 2.0 está disponível no app desktop e na CLI.'));
  if (template.multipart !== undefined || template.binary_file !== undefined)
    throw new Error(t('Corpos multipart e binários estão disponíveis no app desktop.'));
  const url = appendQuery(
    resolvePath(template.url, template.path_params ?? [], variables),
    template.query ?? [],
    variables,
  );
  const headers: [string, string][] = headerEntries(template.headers).map(([key, value]) => [
    key,
    expand(value, variables),
  ]);
  if (template.basic_auth) {
    const [username, password] = template.basic_auth.map((value) => expand(value, variables));
    headers.push([
      'Authorization',
      `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}`,
    ]);
  }
  const body = template.form
    ? new URLSearchParams(
        template.form.map(([key, value]) => [expand(key, variables), expand(value, variables)]),
      ).toString()
    : template.body === null
      ? null
      : expand(template.body, variables);
  if (template.validate_json) {
    try {
      JSON.parse(body || '');
    } catch {
      throw new Error(t('O corpo não contém um JSON válido. Corrija antes de enviar.'));
    }
  }
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error(t('Use uma URL HTTP(S) sem credenciais.'));
  return {
    method: template.method,
    url,
    headers,
    body,
    ...(template.timeout_ms !== undefined ? { timeout_ms: template.timeout_ms } : {}),
    ...(template.redirect_policy !== undefined
      ? { redirect_policy: template.redirect_policy }
      : {}),
  };
}

export function syncUrl(item: RequestItem): RequestItem {
  const index = item.url.indexOf('?');
  const hash = item.url.indexOf('#');
  if (index < 0 || (hash >= 0 && hash < index)) return item;
  const available = item.params.filter((row) => row.enabled && row.key);
  return {
    ...item,
    url: item.url.slice(0, index) + (hash < 0 ? '' : item.url.slice(hash)),
    params: [
      ...[...new URLSearchParams(item.url.slice(index + 1, hash < 0 ? undefined : hash))]
        .filter(([key]) => key)
        .map(([key, value]) => {
          const match = available.findIndex((row) => row.key === key && row.value === value);
          return match < 0 ? pair(key, value) : available.splice(match, 1)[0];
        }),
      ...item.params.filter((row) => !row.enabled || !row.key),
    ],
  };
}

export function urlWithQuery(item: RequestItem) {
  return appendQuery(
    item.url,
    item.params.filter((row) => row.enabled && row.key).map(({ key, value }) => [key, value]),
  );
}

function appendQuery(url: string, rows: [string, string][], variables?: Record<string, string>) {
  if (!rows.length) return url;
  const query = new URLSearchParams(
    variables
      ? rows.map(([key, value]) => [expand(key, variables), expand(value, variables)])
      : rows,
  );
  const hash = url.indexOf('#');
  const base = hash < 0 ? url : url.slice(0, hash);
  const separator = !base.includes('?') ? '?' : /[?&]$/.test(base) ? '' : '&';
  return base + separator + query + (hash < 0 ? '' : url.slice(hash));
}

function resolvePath(url: string, rows: [string, string][], variables?: Record<string, string>) {
  const expandValue = (value: string) => (variables ? expand(value, variables) : value);
  const scheme = url.indexOf('://');
  const authority = scheme < 0 ? 0 : scheme + 3;
  const offset = url.slice(authority).search(/[/?#]/);
  const start = authority + offset;
  if (offset < 0 || url[start] !== '/') return expandValue(url);
  const suffix = url.slice(start);
  const end = suffix.search(/[?#]/);
  const path = end < 0 ? suffix : suffix.slice(0, end);
  const tail = end < 0 ? '' : suffix.slice(end);
  const params = new Map(rows);
  const resolved = path.replace(/\{\{[\s\S]*?\}\}|\{([A-Za-z0-9_-]+)\}/g, (match, key) => {
    if (key === undefined) return match;
    if (!params.has(key))
      throw new RequestResolutionError(t('Parâmetro de caminho ausente: {0}.', key));
    const template = params.get(key)!;
    if (!variables && template.includes('{{')) return template;
    const value = expandValue(template);
    if (!value || value === '.' || value === '..')
      throw new RequestResolutionError(t('Valor inválido para o parâmetro de caminho: {0}.', key));
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
    );
  });
  return expandValue(url.slice(0, start) + resolved + tail);
}

export function importCollection(value: unknown): Collection {
  if (validCollection(value))
    return { ...value, id: uid(), requests: value.requests.map((r) => ({ ...r, id: uid() })) };
  const native = value as {
    name?: string;
    variables?: Record<string, string>;
    requests?: NativeCollection['requests'];
  };
  if (!native || !Array.isArray(native.requests))
    throw new Error(
      t('Formato não suportado. Confira se o arquivo é uma coleção, ambiente ou backup válido.'),
    );
  const collection: Collection = {
    id: uid(),
    name: native.name || t('Coleção importada'),
    description: '',
    folders: [],
    variables: Object.entries(native.variables || {}).map(([k, v]) => pair(k, v)),
    auth: emptyAuth(),
    requests: native.requests.map((step) =>
      syncUrl({
        ...newRequest(),
        name: step.name,
        method: step.request?.method as Method,
        url: step.request?.url ?? '',
        headers: headerEntries(step.request?.headers || {}).map(([k, v]) => pair(k, v)),
        bodyType: step.request?.body ? 'text' : 'none',
        body: step.request?.body || '',
        tests: step.tests || [],
        extract: step.extract || {},
      }),
    ),
  };
  if (!validCollection(collection))
    throw new Error(t('A coleção contém campos inválidos. Confira o arquivo antes de importar.'));
  return collection;
}
