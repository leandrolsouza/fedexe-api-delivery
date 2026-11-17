import { formatNumber, t } from '../lib/i18n';
import { lazy, Suspense, useState, type CSSProperties } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Clock3,
  Cookie,
  Code2,
  Copy,
  CornerDownLeft,
  Database,
  Info,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  authHeaderConflict,
  compileRequestSnippet,
  DEFAULT_TIMEOUT_MS,
  effectiveAuth,
  exportableRequest,
  generatedHeaders,
  headerEntries,
  isSecretHeader,
  DEFAULT_MAX_REDIRECTS,
  MAX_REDIRECT_LIMIT,
  MAX_TIMEOUT_MS,
  requestVariables,
  resolvedVariables,
  syncUrl,
  urlWithQuery,
  type Collection,
  type Environment,
  type HttpResponse,
  type Method,
  type RedirectPolicy,
  type RequestItem,
  type Test,
} from '../lib/models';
import { cn, download, formatBytes } from '../lib/utils';
import { clearSessionCookies, native, normalizeError, saveResponseBody } from '../lib/transport';
import { navigateTabs } from '../lib/keyboard';
import { Button } from './ui/button';
import { Dropdown } from './ui/dropdown';
import { PairEditor } from './PairEditor';
import { CodeViewer } from './CodeViewer';
import { hasScripts, type ScriptResult } from '../lib/scripts';
import { checkResponse, isJsonPointer, responseJson } from '../lib/response-tests';
import { AuthFields, AuthType, authLabel } from './AuthFields';
import { VariableUrlInput, type EditableVariable } from './VariableUrlInput';

export type RequestLayout = 'request' | 'split' | 'response';

const ScriptEditor = lazy(() => import('./ScriptEditor'));
const RequestBody = lazy(() => import('./RequestBody'));
export const minRequestShare = 25;
export const maxRequestShare = 75;

function TestResultList({ results }: { results: ScriptResult[] }) {
  return (
    <div className="test-result-list">
      {results.length ? (
        results.map((test, index) => (
          <div key={index}>
            <span className={test.passed ? 'test-pass' : 'test-fail'}>
              {test.passed ? <CheckCheck size={16} /> : <X size={16} />}
              {t(test.scriptError ? 'Falha de script' : test.passed ? 'Aprovada' : 'Falhou')}
            </span>
            <code>
              {test.label}
              {test.error && ` · ${test.error}`}
            </code>
          </div>
        ))
      ) : (
        <div className="small-empty">{t('Adicione testes na configuração da requisição.')}</div>
      )}
    </div>
  );
}

export function MethodBadge({ method, small = false }: { method: string; small?: boolean }) {
  return (
    <span className={cn('method', `method-${method.toLowerCase()}`, small && 'method-small')}>
      {method === 'DELETE' && small ? 'DEL' : method === 'OPTIONS' && small ? 'OPT' : method}
    </span>
  );
}

export function RequestEditor({
  request,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  defaultRedirectPolicy = 'none',
  initialTab = 'params',
  collection,
  environment,
  sessionVariables,
  onSaveVariable,
  onChange,
  onSave,
  dirty,
  busy,
  onSend,
  onCancel,
  response,
  error,
  scriptResults = [],
  onSnippet,
  wrap,
  layout,
  onLayoutChange,
  requestShare,
  onRequestShareChange,
}: {
  request: RequestItem;
  defaultTimeoutMs?: number;
  defaultRedirectPolicy?: RedirectPolicy;
  initialTab?: 'params' | 'body';
  collection: Collection;
  environment?: Environment;
  sessionVariables?: ReadonlyMap<string, string | null>;
  onSaveVariable: (variable: EditableVariable, value: string) => void;
  onChange: (value: RequestItem) => void;
  onSave: () => void;
  dirty: boolean;
  busy: boolean;
  onSend: () => void;
  onCancel: () => void;
  response?: HttpResponse;
  error?: boolean;
  scriptResults?: ScriptResult[];
  onSnippet: () => void;
  wrap: boolean;
  layout: RequestLayout;
  onLayoutChange: (layout: RequestLayout) => void;
  requestShare: number;
  onRequestShareChange: (share: number) => void;
}) {
  const [tab, setTab] = useState<string>(initialTab);
  const [urlInput, setUrlInput] = useState<string>();
  const [responseTab, setResponseTab] = useState('body');
  const [format, setFormat] = useState('pretty');
  const [savingBody, setSavingBody] = useState(false);
  const [clearingCookies, setClearingCookies] = useState(false);
  const clearCookies = async () => {
    setClearingCookies(true);
    try {
      await clearSessionCookies();
      toast.success(t('Cookies da sessão limpos.'));
    } catch (error) {
      toast.error(normalizeError(error).message);
    } finally {
      setClearingCookies(false);
    }
  };
  const layouts = [
    { id: 'request', label: t('Requisição') },
    { id: 'split', label: t('Dividido') },
    { id: 'response', label: t('Resposta') },
  ] as const;
  const resizePanes = (share: number) =>
    onRequestShareChange(Math.max(minRequestShare, Math.min(maxRequestShare, Math.round(share))));
  const authConflict = authHeaderConflict(request, collection);
  const inheritedAuth = effectiveAuth(request, collection);
  const automaticHeaders = generatedHeaders(request, collection);
  const update = (value: Partial<RequestItem>) => onChange({ ...request, ...value });
  let references: ReturnType<typeof requestVariables> | undefined;
  try {
    references = requestVariables(request, collection, environment, sessionVariables);
  } catch {
    // The send action reports request configuration errors.
  }
  const missing = references?.variables.filter(({ source }) => !source) ?? [];
  const empty = references?.variables.filter(({ empty }) => empty) ?? [];
  const tabs = [
    {
      id: 'params',
      label: t('Parâmetros'),
      count: [...request.params, ...(request.pathParams ?? [])].filter((p) => p.enabled && p.key)
        .length,
    },
    { id: 'auth', label: t('Autorização'), icon: <LockKeyhole size={12} /> },
    {
      id: 'headers',
      label: 'Headers',
      count: request.headers.filter((p) => p.enabled && p.key).length,
    },
    { id: 'body', label: t('Corpo'), dot: request.bodyType !== 'none' },
    { id: 'scripts', label: t('Scripts'), dot: hasScripts(request.scripts) },
    { id: 'tests', label: t('Testes'), count: request.tests.length },
    { id: 'settings', label: t('Configurações') },
  ];
  let responseText = response?.preview || '';
  let json = false;
  try {
    const parsed = JSON.parse(responseText);
    json = true;
    if (format === 'pretty') responseText = JSON.stringify(parsed, null, 2);
  } catch {
    /* Non-JSON responses are displayed as plain text. */
  }
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('Copiado para a área de transferência'));
    } catch {
      toast.error(t('Não foi possível acessar a área de transferência.'));
    }
  };
  const saveBody = async () => {
    if (!response) return;
    if (!response.body_id) {
      download(
        `resposta${response.truncated ? '-previa' : ''}.${json ? 'json' : 'txt'}`,
        response.preview,
        json ? 'application/json' : 'text/plain',
      );
      return;
    }
    setSavingBody(true);
    try {
      const isJson =
        json ||
        response.headers.some(
          ([key, value]) => key.toLowerCase() === 'content-type' && /[/+]json\b/i.test(value),
        );
      if (await saveResponseBody(response.body_id, isJson)) toast.success(t('Resposta salva'));
    } catch (error) {
      toast.error(normalizeError(error).message);
    } finally {
      setSavingBody(false);
    }
  };
  const jsonForTests =
    response && request.tests.some((test) => test.type === 'json')
      ? responseJson(response)
      : undefined;
  const testResults: ScriptResult[] = response
    ? request.tests.map((test) => {
        const label =
          test.type === 'status'
            ? t('Status é {0}', test.equals)
            : test.type === 'header'
              ? t(
                  'Header {0} {1}',
                  test.name,
                  test.equals === undefined ? t('presente') : t('com valor esperado'),
                )
              : `${test.pointer || '(raiz)'} = ${JSON.stringify(test.equals)}`;
        return { label, passed: !checkResponse(test, response, jsonForTests) };
      })
    : [];
  testResults.push(...scriptResults);
  return (
    <div className="request-page">
      <div className="request-heading">
        <div className="request-heading-title">
          <span className="request-type-icon">
            <Braces size={21} />
          </span>
          <div>
            <div className="title-with-badge">
              <input
                aria-label={t('Nome da requisição')}
                className="request-name"
                value={request.name}
                onChange={(e) => update({ name: e.target.value })}
              />
              <span className="subtle-badge">HTTP</span>
            </div>
            <input
              aria-label={t('Descrição da requisição')}
              className="request-description"
              placeholder={t('Adicione uma descrição para esta requisição…')}
              value={request.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </div>
        </div>
        <div className="heading-actions">
          <span className={cn('saved-status', dirty && 'unsaved')}>
            <span className="status-dot" />
            {dirty ? t('Alterações pendentes') : t('Salvo')}
          </span>
          <Button size="sm" variant="outline" onClick={onSave} disabled={!dirty}>
            <Save size={14} />
            {' ' + t('Salvar') + ' '}
            <kbd>Ctrl S</kbd>
          </Button>
          <Dropdown
            trigger={
              <Button variant="ghost" size="icon" aria-label={t('Mais ações da requisição')}>
                <MoreHorizontal size={19} />
              </Button>
            }
            items={[
              { label: t('Copiar como cURL'), icon: <Terminal size={15} />, action: onSnippet },
              {
                label: t('Exportar requisição'),
                icon: <ArrowDownToLine size={15} />,
                action: () =>
                  download(
                    `${request.name}.json`,
                    JSON.stringify(exportableRequest(request), null, 2),
                  ),
              },
            ]}
          />
        </div>
      </div>
      <div className="request-command">
        <form
          className="url-bar"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <div className={`method-select method-${request.method.toLowerCase()}`}>
            <select
              aria-label={t('Método HTTP')}
              value={request.method}
              onChange={(e) => update({ method: e.target.value as Method })}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => (
                <option key={method}>{method}</option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
          <VariableUrlInput
            aria-label={t('URL da requisição')}
            value={urlInput ?? urlWithQuery(request)}
            resolveVariable={(name) => {
              const sessionValue = sessionVariables?.get(name);
              if (sessionValue === null) return undefined;
              if (sessionValue !== undefined) {
                return { id: name, value: sessionValue, source: 'session', secret: true };
              }
              return resolvedVariables(collection, environment).get(name);
            }}
            sourceLabel={(source) =>
              source === 'collection'
                ? collection.name + t(' (coleção)')
                : source === 'environment'
                  ? (environment?.name ?? '')
                  : t('Sessão de scripts')
            }
            onSaveVariable={onSaveVariable}
            onFocus={(event) => setUrlInput(event.currentTarget.value)}
            onChange={(event) => {
              const url = event.target.value;
              setUrlInput(url);
              const hash = url.indexOf('#');
              const query = url.indexOf('?');
              onChange(
                syncUrl({
                  ...request,
                  url,
                  params:
                    query >= 0 && (hash < 0 || query < hash)
                      ? request.params
                      : request.params.filter((row) => !row.enabled || !row.key),
                }),
              );
            }}
            onBlur={() => setUrlInput(undefined)}
            spellCheck={false}
            placeholder={t('https://api.exemplo.com/recurso')}
            required
          />
          {busy ? (
            <Button type="button" className="send-button" variant="secondary" onClick={onCancel}>
              <X size={15} />
              {' ' + t('Cancelar')}
            </Button>
          ) : (
            <Button type="submit" className="send-button">
              <Send size={15} />
              {' ' + t('Enviar') + ' '}
              <kbd>↵</kbd>
            </Button>
          )}
        </form>
        <div className="request-layout-switch" role="group" aria-label={t('Foco do editor')}>
          {layouts.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={layout === id}
              onClick={() => onLayoutChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`request-panes layout-${layout}`}
        style={
          {
            '--request-share': `${requestShare}fr`,
            '--response-share': `${100 - requestShare}fr`,
          } as CSSProperties
        }
      >
        <div className="request-surface" id="request-configuration" hidden={layout === 'response'}>
          <div className="request-tabs">
            <div
              className="request-tabs-list"
              role="tablist"
              aria-label={t('Configuração da requisição')}
              onKeyDown={navigateTabs}
            >
              {tabs.map((t) => (
                <button
                  id={`tab-${t.id}`}
                  className={cn('tab-button', tab === t.id && 'active')}
                  role="tab"
                  aria-selected={tab === t.id}
                  tabIndex={tab === t.id ? 0 : -1}
                  aria-controls={tab === t.id ? `panel-${t.id}` : undefined}
                  key={t.id}
                  onClick={() => setTab(t.id)}
                >
                  {t.icon}
                  {t.label}
                  {!!t.count && <span className="tab-count">{formatNumber(t.count)}</span>}
                  {t.dot && <span className="tiny-dot" />}
                </button>
              ))}
            </div>
            <button className="code-shortcut" title={t('Gerar código cURL')} onClick={onSnippet}>
              <Code2 size={17} />
            </button>
          </div>
          <div
            className="request-config"
            id={`panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
          >
            {tab === 'params' && (
              <div className="params-layout">
                <div className="params-main">
                  <div className="section-heading">
                    <h3>{t('Parâmetros de query')}</h3>
                    <span>{t('As linhas ativas aparecem na URL na ordem da tabela.')}</span>
                  </div>
                  <PairEditor rows={request.params} onChange={(params) => update({ params })} />
                  <div className="section-heading path-parameters-heading">
                    <h3>{t('Parâmetros de caminho')}</h3>
                    <span>
                      {t('Use') + ' '}
                      <code>{'{id}'}</code>
                      {' ' + t('no caminho e informe o valor na linha') + ' '}
                      <code>id</code>.
                    </span>
                  </div>
                  <PairEditor
                    kind={t('parâmetro de caminho')}
                    rows={request.pathParams ?? []}
                    onChange={(pathParams) => update({ pathParams })}
                  />
                </div>
                <aside className="tip-card">
                  <span className="tip-icon">
                    <Sparkles size={16} />
                  </span>
                  <h4>
                    {t('Menos repetição.')}
                    <br />
                    {t('Mais produtividade.')}
                  </h4>
                  <p>
                    {t('Use') + ' '}
                    <code>{t('{{variavel}}')}</code>
                    {' ' + t('para reutilizar valores entre suas requisições.')}
                  </p>
                  <div className="tip-environment">
                    <span className={`status-dot dot-${environment?.color || 'green'}`} />
                    <span>{environment?.name || t('Sem ambiente')}</span>
                    <span className="tiny-badge">{t('ativo')}</span>
                  </div>
                </aside>
              </div>
            )}
            {tab === 'headers' && (
              <>
                <div className="section-heading">
                  <h3>{t('Headers da requisição')}</h3>
                  <span>
                    {native
                      ? t('Os nomes podem se repetir em linhas ativas.')
                      : t('O navegador pode combinar linhas com o mesmo nome.')}
                  </span>
                </div>
                <PairEditor
                  kind="header"
                  rows={request.headers}
                  onChange={(headers) => update({ headers })}
                  maskValue={(row) => isSecretHeader(row, collection, environment)}
                  markSecrets
                />
                {automaticHeaders.length > 0 && (
                  <div className="path-parameters-heading">
                    <div className="section-heading">
                      <h3>{t('Gerados pelo app')}</h3>
                    </div>
                    <dl className="generated-headers">
                      {automaticHeaders.map(({ name, value, secret, source }) => (
                        <div key={name}>
                          <dt>
                            <code>{name}</code> <span className="muted">({source})</span>
                          </dt>
                          <dd>
                            <code aria-label={secret ? t('Valor secreto mascarado') : undefined}>
                              {secret ? '••••••••' : value}
                            </code>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </>
            )}
            {tab === 'auth' && (
              <div className="auth-layout">
                <AuthType auth={request.auth} onChange={(auth) => update({ auth })} inheritance />
                <div className="auth-fields">
                  {request.auth.type === 'inherit' ? (
                    <div className="inline-info">
                      <ShieldCheck size={24} />
                      <div>
                        <strong>
                          {authLabel(
                            inheritedAuth.type === 'inherit' ? 'none' : inheritedAuth.type,
                          )}
                        </strong>
                        <p>
                          {t('Configuração da coleção') + ' '}
                          {collection.name}.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <AuthFields auth={request.auth} onChange={(auth) => update({ auth })} />
                  )}
                </div>
              </div>
            )}
            {tab === 'body' && (
              <Suspense fallback={<p role="status">{t('Carregando editor…')}</p>}>
                <RequestBody request={request} onChange={update} />
              </Suspense>
            )}
            {tab === 'scripts' && (
              <Suspense fallback={<p role="status">{t('Carregando editor…')}</p>}>
                <ScriptEditor
                  key={request.id}
                  scripts={request.scripts}
                  onChange={(scripts) => update({ scripts })}
                />
              </Suspense>
            )}
            {tab === 'tests' && <TestEditor request={request} onChange={update} />}
            {tab === 'settings' && (
              <div className="network-settings">
                <div>
                  <span className="settings-icon">
                    <Clock3 size={18} />
                  </span>
                  <div>
                    <label className="field-label">
                      {t('Timeout da requisição (ms)')}
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={MAX_TIMEOUT_MS}
                        step={1}
                        value={request.timeoutMs ?? ''}
                        placeholder={String(defaultTimeoutMs)}
                        aria-describedby="request-timeout-hint"
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber;
                          update({
                            timeoutMs: Number.isInteger(value)
                              ? Math.min(MAX_TIMEOUT_MS, Math.max(1, value))
                              : undefined,
                          });
                        }}
                      />
                    </label>
                    <p id="request-timeout-hint">
                      {t(
                        'Deixe em branco para usar o padrão do workspace ({0} ms).',
                        formatNumber(defaultTimeoutMs),
                      )}
                    </p>
                  </div>
                </div>
                <div>
                  <span className="settings-icon">
                    <ShieldCheck size={18} />
                  </span>
                  <div>
                    {native ? (
                      <>
                        <label className="field-label">
                          {t('Validação de certificados TLS')}
                          <select
                            className="input"
                            value={request.verifyTls === false ? 'off' : 'on'}
                            aria-describedby="request-tls-hint"
                            onChange={(event) =>
                              update({
                                verifyTls: event.target.value === 'off' ? false : undefined,
                              })
                            }
                          >
                            <option value="on">{t('Ativa (padrão)')}</option>
                            <option value="off">{t('Desativada')}</option>
                          </select>
                        </label>
                        <p id="request-tls-hint">
                          {t(
                            'Desative apenas em ambientes de teste confiáveis. A conexão poderá aceitar certificados inválidos.',
                          )}
                        </p>
                      </>
                    ) : (
                      <>
                        <h4>{t('Validação de certificados TLS')}</h4>
                        <p>{t('A verificação é controlada pelo navegador.')}</p>
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <span className="settings-icon">
                    <ArrowUpRight size={18} />
                  </span>
                  <div>
                    <label className="field-label">
                      {t('Redirecionamentos')}
                      <select
                        className="input"
                        value={request.redirectPolicy ?? (native ? '' : 'none')}
                        onChange={(event) =>
                          update({
                            redirectPolicy:
                              event.target.value === ''
                                ? undefined
                                : (event.target.value as RedirectPolicy),
                          })
                        }
                      >
                        {native && (
                          <option value="">
                            {t(
                              'Usar padrão do workspace ({0})',
                              t(
                                defaultRedirectPolicy === 'same_origin'
                                  ? 'Seguir apenas na mesma origem'
                                  : 'Não seguir',
                              ),
                            )}
                          </option>
                        )}
                        <option value="none">{t('Não seguir')}</option>
                        <option value="same_origin" disabled={!native}>
                          {t('Seguir apenas na mesma origem')}
                        </option>
                      </select>
                    </label>
                    <p>
                      {native
                        ? t('Uma mudança de protocolo, host ou porta encerra o redirecionamento.')
                        : t('Seguir redirecionamentos da mesma origem requer o app desktop.')}
                    </p>
                    {native && (
                      <>
                        <label className="field-label">
                          {t('Máximo de redirecionamentos')}
                          <input
                            className="input"
                            type="number"
                            min={1}
                            max={MAX_REDIRECT_LIMIT}
                            step={1}
                            value={request.maxRedirects ?? ''}
                            placeholder={String(DEFAULT_MAX_REDIRECTS)}
                            aria-describedby="request-redirect-limit-hint"
                            onChange={(event) => {
                              const value = event.currentTarget.valueAsNumber;
                              update({
                                maxRedirects: Number.isInteger(value)
                                  ? Math.min(MAX_REDIRECT_LIMIT, Math.max(1, value))
                                  : undefined,
                              });
                            }}
                          />
                        </label>
                        <p id="request-redirect-limit-hint">
                          {t(
                            'Deixe em branco para usar o limite padrão de {0}.',
                            DEFAULT_MAX_REDIRECTS,
                          )}
                        </p>
                        <label className="field-label">
                          {t('Preservar método HTTP em 301, 302 e 303')}
                          <select
                            className="input"
                            value={request.preserveRedirectMethod ? 'on' : 'off'}
                            aria-describedby="request-redirect-method-hint"
                            onChange={(event) =>
                              update({
                                preserveRedirectMethod: event.target.value === 'on' || undefined,
                              })
                            }
                          >
                            <option value="off">{t('Desativada')}</option>
                            <option value="on">{t('Ativa')}</option>
                          </select>
                        </label>
                        <p id="request-redirect-method-hint">
                          {t(
                            'Ao seguir redirecionamentos na mesma origem, reenvia o método e o corpo quando ele pode ser repetido.',
                          )}
                        </p>
                      </>
                    )}
                  </div>
                </div>
                {native && (
                  <div>
                    <span className="settings-icon">
                      <Cookie size={18} />
                    </span>
                    <div>
                      <label className="field-label">
                        {t('Cookies da sessão')}
                        <select
                          className="input"
                          value={request.ignoreCookies ? 'ignore' : 'use'}
                          aria-describedby="request-cookie-hint"
                          onChange={(event) =>
                            update({ ignoreCookies: event.target.value === 'ignore' || undefined })
                          }
                        >
                          <option value="use">{t('Usar cookies da sessão')}</option>
                          <option value="ignore">{t('Ignorar nesta requisição')}</option>
                        </select>
                      </label>
                      <p id="request-cookie-hint">
                        {t('O app guarda os cookies em memória e os reutiliza na mesma origem.')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={clearingCookies}
                      onClick={clearCookies}
                    >
                      {t('Limpar cookies da sessão')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          {authConflict && (
            <div className="request-variable-warning" role="status">
              {authConflict}
            </div>
          )}
          <div className="request-context">
            <span>
              {t('Ambiente ativo:') + ' '}
              {environment?.name ?? t('Nenhum')}
            </span>
            <button onClick={onSnippet}>
              {t('Gerar código') + ' '}
              <ArrowUpRight size={12} />
            </button>
          </div>
          {(missing.length > 0 || empty.length > 0 || references?.unclosed) && (
            <div className="request-variable-warning" role="status">
              {missing.length > 0 && (
                <div>
                  {t('Variáveis ausentes:') + ' '}
                  {missing.map(({ name }) => name || '{{}}').join(', ')}
                </div>
              )}
              {empty.length > 0 && (
                <div>
                  {t('Variáveis secretas sem valor:') + ' '}
                  {empty.map(({ name }) => name).join(', ')}
                </div>
              )}
              {references?.unclosed && (
                <div>
                  {t('Feche cada referência com') + ' '}
                  {'}}'}.
                </div>
              )}
            </div>
          )}
          {!!references?.variables.length && (
            <details className="request-variables">
              <summary>
                {t('Origem das variáveis (')}
                {formatNumber(references.variables.length)})
              </summary>
              <dl>
                {references.variables.map(({ name, source, empty }) => (
                  <div key={name}>
                    <dt>
                      <code>{`{{${name}}}`}</code>
                    </dt>
                    <dd>
                      {source === 'environment'
                        ? environment?.name
                        : source === 'collection'
                          ? collection.name + t(' (coleção)')
                          : source === 'session'
                            ? t('Sessão de scripts')
                            : t('Ausente')}
                      {empty && t(' (sem valor)')}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <div className="editor-bottom-note">
            <button onClick={onSnippet}>
              <Terminal size={12} /> cURL
            </button>
          </div>
        </div>
        {layout === 'split' && (
          <div
            className="request-pane-divider"
            role="separator"
            aria-label={t('Redimensionar painéis')}
            aria-orientation="horizontal"
            aria-controls="request-configuration"
            aria-valuemin={minRequestShare}
            aria-valuemax={maxRequestShare}
            aria-valuenow={requestShare}
            tabIndex={0}
            onPointerDown={(event) => {
              if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const divider = event.currentTarget;
              if (!divider.hasPointerCapture(event.pointerId)) return;
              const panes = divider.parentElement!.getBoundingClientRect();
              const height = divider.offsetHeight;
              resizePanes(
                ((event.clientY - panes.top - height / 2) / (panes.height - height)) * 100,
              );
            }}
            onKeyDown={(event) => {
              switch (event.key) {
                case 'ArrowUp':
                  resizePanes(requestShare - 5);
                  break;
                case 'ArrowDown':
                  resizePanes(requestShare + 5);
                  break;
                case 'Home':
                  resizePanes(minRequestShare);
                  break;
                case 'End':
                  resizePanes(maxRequestShare);
                  break;
                default:
                  return;
              }
              event.preventDefault();
            }}
          />
        )}
        <section className="response-panel" aria-label={t('Resposta HTTP')}>
          <div className="response-heading">
            <div className="response-heading-left">
              <h3>{t('Resposta')}</h3>
              {response && !busy && !error && (
                <>
                  <span
                    className={`response-status ${response.status >= 400 ? 'status-error' : ''}`}
                  >
                    <span className="status-dot" />
                    {response.status}{' '}
                    {(
                      {
                        200: 'OK',
                        201: t('Criado'),
                        204: t('Sem conteúdo'),
                        400: t('Requisição inválida'),
                        401: t('Não autorizado'),
                        404: t('Não encontrado'),
                        500: t('Erro do servidor'),
                      } as Record<number, string>
                    )[response.status] || ''}
                  </span>
                  <span className="response-metric">
                    <Clock3 size={12} />
                    {formatNumber(response.duration_ms)} ms
                  </span>
                  <span className="response-metric">
                    <Database size={12} />
                    {formatBytes(
                      response.size_bytes ?? new TextEncoder().encode(response.preview).length,
                    )}
                    {response.truncated && response.size_bytes === undefined && t(' (prévia)')}
                  </span>
                </>
              )}
            </div>
            <div className="response-actions">
              {layout !== 'request' && response && !busy && !error && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copy(response.preview)}
                    aria-label={t('Copiar prévia da resposta')}
                  >
                    <Copy size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={saveBody}
                    disabled={savingBody}
                    aria-label={
                      response.body_id ? t('Salvar corpo completo') : t('Salvar prévia da resposta')
                    }
                    title={
                      response.body_id ? t('Salvar corpo completo') : t('Salvar prévia da resposta')
                    }
                  >
                    <ArrowDownToLine size={15} />
                  </Button>
                </>
              )}
              <span className="response-indicator" role="status">
                <span className={cn('status-dot', busy && 'pulse')} />
                {busy
                  ? t('Enviando')
                  : error
                    ? t('Falhou')
                    : response
                      ? t('Recebida')
                      : t('Aguardando')}
              </span>
              {layout === 'request' && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('Mostrar resposta')}
                  title={t('Mostrar resposta')}
                  aria-controls="response-content"
                  aria-expanded={false}
                  onClick={() => onLayoutChange('split')}
                >
                  <ChevronUp size={16} />
                </Button>
              )}
            </div>
          </div>
          <div id="response-content" className="response-content" hidden={layout === 'request'}>
            {busy ? (
              <div className="response-empty">
                <div className="response-art loading-art">
                  <LoaderCircle className="spin" size={32} />
                </div>
                <h3>{t('A caminho da sua API…')}</h3>
                <p>{t('Preparando espaço para a próxima resposta.')}</p>
                <Button variant="outline" size="sm" onClick={onCancel}>
                  {t('Cancelar requisição')}
                </Button>
              </div>
            ) : error ? (
              <div className="response-error">
                <span className="error-icon">
                  <TriangleAlert size={24} />
                </span>
                <div>
                  <h3>{t('Não foi dessa vez')}</h3>
                  {scriptResults.length > 0 && <TestResultList results={scriptResults} />}
                  <Button size="sm" variant="outline" onClick={onSend}>
                    {t('Tentar novamente') + ' '}
                    <ArrowRight size={13} />
                  </Button>
                </div>
              </div>
            ) : response ? (
              <>
                <div className="response-toolbar">
                  <div
                    className="response-tabs"
                    role="tablist"
                    aria-label={t('Visualização da resposta')}
                    onKeyDown={navigateTabs}
                  >
                    {[
                      { id: 'body', label: t('Corpo') },
                      { id: 'headers', label: 'Headers', count: response.headers.length },
                      {
                        id: 'tests',
                        label: t('Resultados dos testes'),
                        count: testResults.length,
                        failed: testResults.some((test) => !test.passed),
                      },
                    ].map((t) => (
                      <button
                        id={`response-tab-${t.id}`}
                        role="tab"
                        aria-controls={responseTab === t.id ? `response-panel-${t.id}` : undefined}
                        aria-selected={responseTab === t.id}
                        tabIndex={responseTab === t.id ? 0 : -1}
                        className={cn('tab-button', responseTab === t.id && 'active')}
                        onClick={() => setResponseTab(t.id)}
                        key={t.id}
                      >
                        {t.label}
                        {t.count !== undefined && (
                          <span className={cn('tab-count', t.failed && 'red-text')}>
                            {formatNumber(t.count)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {responseTab === 'body' && (
                    <div className="format-select">
                      <select
                        aria-label={t('Formato da resposta')}
                        value={format}
                        onChange={(e) => setFormat(e.target.value)}
                      >
                        <option value="pretty">{t('Formatado')}</option>
                        <option value="raw">{t('Original')}</option>
                      </select>
                      <span>{json ? 'JSON' : t('Texto')}</span>
                    </div>
                  )}
                </div>
                {response.truncated && (
                  <div className="truncated-banner">
                    <Info size={14} />
                    {' ' + t('Prévia limitada a 256 KiB.')}{' '}
                    {response.body_id
                      ? t('O download inclui o corpo completo.')
                      : t('O download inclui a prévia.')}
                  </div>
                )}
                <div
                  id={`response-panel-${responseTab}`}
                  role="tabpanel"
                  aria-labelledby={`response-tab-${responseTab}`}
                  tabIndex={0}
                  className="response-tab-panel"
                >
                  {responseTab === 'body' ? (
                    responseText ? (
                      <CodeViewer
                        key={`${request.id}-${formatNumber(response.duration_ms)}`}
                        value={responseText}
                        json={json}
                        wrap={wrap}
                      />
                    ) : (
                      <div className="small-empty">{t('A resposta não contém corpo.')}</div>
                    )
                  ) : responseTab === 'headers' ? (
                    <div className="response-header-table">
                      {response.headers.map(([key, value], i) => (
                        <div key={i}>
                          <code>{key}</code>
                          <code>{value}</code>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <TestResultList results={testResults} />
                  )}
                </div>
              </>
            ) : (
              <div className="response-empty">
                <div className="response-art">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="art-spark art-spark-one">✦</div>
                  <div className="art-spark art-spark-two">✦</div>
                  <div className="art-code">
                    <Braces size={31} strokeWidth={1.5} />
                    <div className="art-code-lines">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                  <span className="art-status">
                    <Check size={12} />
                    200 OK
                  </span>
                </div>
                <h3>{t('Uma boa API começa com um olá.')}</h3>
                <p>{t('Envie sua requisição e veja a resposta ganhar vida aqui.')}</p>
                <div className="empty-shortcut">
                  <kbd>Ctrl</kbd>
                  <span>+</span>
                  <kbd>
                    Enter <CornerDownLeft size={10} />
                  </kbd>
                  <span>{t('para enviar')}</span>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function TestEditor({
  request,
  onChange,
}: {
  request: RequestItem;
  onChange: (value: Partial<RequestItem>) => void;
}) {
  const [extractText, setExtractText] = useState(JSON.stringify(request.extract, null, 2));
  const changeTest = (index: number, value: Test) =>
    onChange({ tests: request.tests.map((test, i) => (i === index ? value : test)) });
  return (
    <div className="tests-editor">
      <div className="section-heading">
        <h3>{t('Testes declarativos')}</h3>
        <span>{t('Valide respostas sem precisar escrever scripts')}</span>
      </div>
      {request.tests.map((test, index) => (
        <div className="test-rule" key={index}>
          <span className="test-rule-icon">
            <Check size={13} />
          </span>
          <select
            className="input"
            aria-label={t('Tipo do teste {0}', index + 1)}
            value={test.type === 'header' && test.equals !== undefined ? 'header-value' : test.type}
            onChange={(e) =>
              changeTest(
                index,
                e.target.value === 'status'
                  ? { type: 'status', equals: 200 }
                  : e.target.value === 'header' || e.target.value === 'header-value'
                    ? {
                        type: 'header',
                        name: test.type === 'header' ? test.name : 'content-type',
                        ...(e.target.value === 'header-value'
                          ? { equals: test.type === 'header' ? (test.equals ?? '') : '' }
                          : {}),
                      }
                    : { type: 'json', pointer: '/success', equals: true },
              )
            }
          >
            <option value="status">{t('Status HTTP')}</option>
            <option value="header">{t('Header presente')}</option>
            <option value="header-value">{t('Valor do header')}</option>
            <option value="json">{t('Campo JSON')}</option>
          </select>
          {test.type === 'status' ? (
            <>
              <span>{t('é igual a')}</span>
              <input
                className="input mono"
                aria-label={t('Status esperado')}
                type="number"
                min={100}
                max={599}
                value={test.equals}
                onChange={(e) => changeTest(index, { ...test, equals: Number(e.target.value) })}
              />
            </>
          ) : test.type === 'header' ? (
            <>
              <input
                className="input mono grow"
                aria-label={t('Nome do header esperado')}
                value={test.name}
                onChange={(e) => changeTest(index, { ...test, name: e.target.value })}
              />
              {test.equals !== undefined && (
                <input
                  className="input mono grow"
                  aria-label={t('Valor esperado do header')}
                  placeholder={t('Valor exato')}
                  value={test.equals}
                  onChange={(e) => changeTest(index, { ...test, equals: e.target.value })}
                />
              )}
            </>
          ) : (
            <>
              <input
                className="input mono"
                aria-label={t('JSON Pointer do teste')}
                value={test.pointer}
                onChange={(e) => changeTest(index, { ...test, pointer: e.target.value })}
              />
              <span>=</span>
              <JsonValueInput
                value={test.equals}
                onChange={(value) => changeTest(index, { ...test, equals: value })}
              />
            </>
          )}
          <button
            className="inline-icon"
            aria-label={t('Excluir teste {0}', index + 1)}
            onClick={() => onChange({ tests: request.tests.filter((_, i) => i !== index) })}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="add-row"
        onClick={() => onChange({ tests: [...request.tests, { type: 'status', equals: 200 }] })}
      >
        <Plus size={14} />
        {' ' + t('Adicionar teste')}
      </Button>
      <details className="extraction-editor">
        <summary>
          <Settings2 size={14} />
          {' ' + t('Extrair variáveis da resposta') + ' '}
          <CircleHelp size={13} />
        </summary>
        <p>
          {t('Mapeie nomes para JSON Pointers. Os valores são isolados por execução do runner.')}
        </p>
        <textarea
          aria-label={t('Extração de variáveis JSON')}
          className="input mono"
          value={extractText}
          onChange={(e) => setExtractText(e.target.value)}
          onBlur={() => {
            try {
              const value = JSON.parse(extractText);
              if (
                !value ||
                Array.isArray(value) ||
                typeof value !== 'object' ||
                Object.values(value).some((v) => typeof v !== 'string' || !isJsonPointer(v))
              )
                throw new Error();
              onChange({ extract: value });
            } catch {
              toast.error(
                t('Use um objeto JSON com nomes e JSON Pointers, como {"token":"/token"}.'),
              );
              setExtractText(JSON.stringify(request.extract, null, 2));
            }
          }}
        />
      </details>
    </div>
  );
}

function JsonValueInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value));
  return (
    <input
      className="input mono"
      aria-label={t('Valor JSON esperado')}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        try {
          onChange(JSON.parse(text));
        } catch {
          toast.error(t('Informe um valor JSON válido: true, 123 ou "texto".'));
          setText(JSON.stringify(value));
        }
      }}
    />
  );
}

export function curlFor(request: RequestItem, collection: Collection, environment?: Environment) {
  if (request.bodyType === 'binary' || request.bodyType === 'multipart')
    throw new Error(t('A geração de cURL para corpos com arquivos ainda não está disponível.'));
  const compiled = compileRequestSnippet(request, collection, environment);
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  return [
    `curl --request ${compiled.method}`,
    `  --url ${quote(compiled.url)}`,
    ...headerEntries(compiled.headers).map(
      ([key, value]) => `  --header ${quote(`${key}: ${value}`)}`,
    ),
    ...(compiled.body ? [`  --data-raw ${quote(compiled.body)}`] : []),
  ].join(' \\\n');
}
