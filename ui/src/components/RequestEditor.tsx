import { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  CornerDownLeft,
  Database,
  FileJson2,
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
  compileRequest,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  effectiveAuth,
  exportableRequest,
  generatedHeaders,
  headerEntries,
  isSecretHeader,
  requestVariables,
  syncUrl,
  urlWithQuery,
  variablesFor,
  type Collection,
  type Environment,
  type HttpResponse,
  type Method,
  type RequestItem,
  type Test,
} from '../lib/models';
import { cn, download, formatBytes } from '../lib/utils';
import { native, normalizeError, saveResponseBody } from '../lib/transport';
import { navigateTabs } from '../lib/keyboard';
import { Button } from './ui/button';
import { Dropdown } from './ui/dropdown';
import { PairEditor } from './PairEditor';
import { CodeViewer } from './CodeViewer';
import { checkResponse, isJsonPointer, responseJson } from '../lib/response-tests';
import { FileBodyEditor } from './FileBodyEditor';
import { AuthFields, AuthType, authLabels } from './AuthFields';

export function MethodBadge({ method, small = false }: { method: string; small?: boolean }) {
  return (
    <span className={cn('method', `method-${method.toLowerCase()}`, small && 'method-small')}>
      {method === 'DELETE' && small ? 'DEL' : method === 'OPTIONS' && small ? 'OPT' : method}
    </span>
  );
}

export function RequestEditor({
  request,
  collection,
  environment,
  onChange,
  onSave,
  dirty,
  busy,
  onSend,
  onCancel,
  response,
  error,
  onSnippet,
  wrap,
}: {
  request: RequestItem;
  collection: Collection;
  environment?: Environment;
  onChange: (value: RequestItem) => void;
  onSave: () => void;
  dirty: boolean;
  busy: boolean;
  onSend: () => void;
  onCancel: () => void;
  response?: HttpResponse;
  error?: string;
  onSnippet: () => void;
  wrap: boolean;
}) {
  const [tab, setTab] = useState('params');
  const [urlInput, setUrlInput] = useState<string>();
  const [responseTab, setResponseTab] = useState('body');
  const [format, setFormat] = useState('pretty');
  const [savingBody, setSavingBody] = useState(false);
  const authConflict = authHeaderConflict(request, collection);
  const inheritedAuth = effectiveAuth(request, collection);
  const automaticHeaders = generatedHeaders(request, collection);
  const update = (value: Partial<RequestItem>) => onChange({ ...request, ...value });
  let references: ReturnType<typeof requestVariables> | undefined;
  try {
    references = requestVariables(request, collection, environment);
  } catch {
    // The send action reports request configuration errors.
  }
  const missing = references?.variables.filter(({ source }) => !source) ?? [];
  const tabs = [
    {
      id: 'params',
      label: 'Parâmetros',
      count: [...request.params, ...(request.pathParams ?? [])].filter((p) => p.enabled && p.key)
        .length,
    },
    { id: 'auth', label: 'Autorização', icon: <LockKeyhole size={12} /> },
    {
      id: 'headers',
      label: 'Headers',
      count: request.headers.filter((p) => p.enabled && p.key).length,
    },
    { id: 'body', label: 'Corpo', dot: request.bodyType !== 'none' },
    { id: 'tests', label: 'Testes', count: request.tests.length },
    { id: 'settings', label: 'Configurações' },
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
      toast.success('Copiado para a área de transferência');
    } catch {
      toast.error('Não foi possível acessar a área de transferência.');
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
      if (await saveResponseBody(response.body_id, isJson)) toast.success('Resposta salva');
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
  const testResults = response
    ? request.tests.map((test) => {
        const label =
          test.type === 'status'
            ? `Status é ${test.equals}`
            : test.type === 'header'
              ? `Header ${test.name} ${test.equals === undefined ? 'presente' : 'com valor esperado'}`
              : `${test.pointer || '(raiz)'} = ${JSON.stringify(test.equals)}`;
        return { label, passed: !checkResponse(test, response, jsonForTests) };
      })
    : [];
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
                aria-label="Nome da requisição"
                className="request-name"
                value={request.name}
                onChange={(e) => update({ name: e.target.value })}
              />
              <span className="subtle-badge">HTTP</span>
            </div>
            <input
              aria-label="Descrição da requisição"
              className="request-description"
              placeholder="Adicione uma descrição para esta requisição…"
              value={request.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </div>
        </div>
        <div className="heading-actions">
          <span className={cn('saved-status', dirty && 'unsaved')}>
            <span className="status-dot" />
            {dirty ? 'Alterações pendentes' : 'Salvo localmente'}
          </span>
          <Button size="sm" variant="outline" onClick={onSave} disabled={!dirty}>
            <Save size={14} /> Salvar <kbd>Ctrl S</kbd>
          </Button>
          <Dropdown
            trigger={
              <Button variant="ghost" size="icon" aria-label="Mais ações da requisição">
                <MoreHorizontal size={19} />
              </Button>
            }
            items={[
              { label: 'Copiar como cURL', icon: <Terminal size={15} />, action: onSnippet },
              {
                label: 'Exportar requisição',
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
      <div className="request-surface">
        <form
          className="url-bar"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <div className={`method-select method-${request.method.toLowerCase()}`}>
            <select
              aria-label="Método HTTP"
              value={request.method}
              onChange={(e) => update({ method: e.target.value as Method })}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => (
                <option key={method}>{method}</option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
          <input
            aria-label="URL da requisição"
            className="url-input"
            value={urlInput ?? urlWithQuery(request)}
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
            placeholder="https://api.exemplo.com/recurso"
            required
          />
          {busy ? (
            <Button type="button" className="send-button" variant="secondary" onClick={onCancel}>
              <X size={15} /> Cancelar
            </Button>
          ) : (
            <Button type="submit" className="send-button">
              <Send size={15} /> Enviar <kbd>↵</kbd>
            </Button>
          )}
        </form>
        <div className="request-tabs">
          <div
            className="request-tabs-list"
            role="tablist"
            aria-label="Configuração da requisição"
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
                {!!t.count && <span className="tab-count">{t.count}</span>}
                {t.dot && <span className="tiny-dot" />}
              </button>
            ))}
          </div>
          <button className="code-shortcut" title="Gerar código cURL" onClick={onSnippet}>
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
                  <h3>Parâmetros de query</h3>
                  <span>As linhas ativas aparecem na URL na ordem da tabela.</span>
                </div>
                <PairEditor rows={request.params} onChange={(params) => update({ params })} />
                <div className="section-heading path-parameters-heading">
                  <h3>Parâmetros de caminho</h3>
                  <span>
                    Use <code>{'{id}'}</code> no caminho e informe o valor na linha <code>id</code>.
                  </span>
                </div>
                <PairEditor
                  kind="parâmetro de caminho"
                  rows={request.pathParams ?? []}
                  onChange={(pathParams) => update({ pathParams })}
                />
              </div>
              <aside className="tip-card">
                <span className="tip-icon">
                  <Sparkles size={16} />
                </span>
                <h4>
                  Menos repetição.
                  <br />
                  Mais produtividade.
                </h4>
                <p>
                  Use <code>{'{{variavel}}'}</code> para reutilizar valores entre suas requisições.
                </p>
                <div className="tip-environment">
                  <span className={`status-dot dot-${environment?.color || 'green'}`} />
                  <span>{environment?.name || 'Sem ambiente'}</span>
                  <span className="tiny-badge">ativo</span>
                </div>
              </aside>
            </div>
          )}
          {tab === 'headers' && (
            <>
              <div className="section-heading">
                <h3>Headers da requisição</h3>
                <span>
                  {native
                    ? 'Os nomes podem se repetir em linhas ativas.'
                    : 'O navegador pode combinar linhas com o mesmo nome.'}
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
                    <h3>Gerados pelo app</h3>
                  </div>
                  <dl className="generated-headers">
                    {automaticHeaders.map(({ name, value, secret, source }) => (
                      <div key={name}>
                        <dt>
                          <code>{name}</code> <span className="muted">({source})</span>
                        </dt>
                        <dd>
                          <code aria-label={secret ? 'Valor secreto mascarado' : undefined}>
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
                        {authLabels[inheritedAuth.type === 'inherit' ? 'none' : inheritedAuth.type]}
                      </strong>
                      <p>Configuração da coleção {collection.name}.</p>
                    </div>
                  </div>
                ) : (
                  <AuthFields auth={request.auth} onChange={(auth) => update({ auth })} />
                )}
              </div>
            </div>
          )}
          {tab === 'body' && (
            <>
              <div className="body-options">
                {(['none', 'json', 'text', 'urlencoded', 'multipart', 'binary'] as const).map(
                  (type) => (
                    <label key={type}>
                      <input
                        type="radio"
                        name="body-type"
                        checked={request.bodyType === type}
                        onChange={() => update({ bodyType: type })}
                      />
                      {
                        {
                          none: 'Nenhum',
                          json: 'JSON',
                          text: 'Texto',
                          urlencoded: 'Form URL-encoded',
                          multipart: 'Multipart',
                          binary: 'Arquivo binário',
                        }[type]
                      }
                    </label>
                  ),
                )}
              </div>
              {request.bodyType === 'none' ? (
                <div className="body-empty">
                  <FileJson2 size={28} />
                  <p>Esta requisição não tem corpo.</p>
                </div>
              ) : request.bodyType === 'urlencoded' ? (
                <PairEditor
                  kind="campo"
                  rows={request.form}
                  onChange={(form) => update({ form })}
                />
              ) : request.bodyType === 'multipart' || request.bodyType === 'binary' ? (
                <FileBodyEditor request={request} onChange={update} />
              ) : (
                <div className="body-code">
                  <div className="editor-toolbar">
                    <span>
                      <span className="status-dot dot-purple" />
                      {request.bodyType === 'json' ? 'JSON' : 'Texto bruto'}
                    </span>
                    {request.bodyType === 'json' && (
                      <button
                        onClick={() => {
                          try {
                            update({ body: JSON.stringify(JSON.parse(request.body), null, 2) });
                          } catch {
                            toast.error('JSON inválido. Verifique a sintaxe do corpo.');
                          }
                        }}
                      >
                        <Braces size={13} /> Formatar
                      </button>
                    )}
                  </div>
                  <textarea
                    aria-label="Corpo da requisição"
                    spellCheck={false}
                    className="body-textarea"
                    value={request.body}
                    onChange={(e) => update({ body: e.target.value })}
                    placeholder={
                      request.bodyType === 'json'
                        ? '{\n  "mensagem": "Olá, mundo!"\n}'
                        : 'Digite o corpo da requisição…'
                    }
                  />
                </div>
              )}
            </>
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
                    Timeout da requisição (ms)
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={MAX_TIMEOUT_MS}
                      step={1}
                      value={request.timeoutMs ?? DEFAULT_TIMEOUT_MS}
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
                  <p>Limite para receber a resposta completa.</p>
                </div>
              </div>
              <div>
                <span className="settings-icon">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <h4>Validação de certificados TLS</h4>
                  <p>Ativa por padrão para manter suas conexões seguras.</p>
                </div>
                <span className="green-text">
                  Sempre ativa <Check size={13} />
                </span>
              </div>
              <div>
                <span className="settings-icon">
                  <ArrowUpRight size={18} />
                </span>
                <div>
                  <label className="field-label">
                    Redirecionamentos
                    <select
                      className="input"
                      value={request.redirectPolicy ?? 'none'}
                      onChange={(event) =>
                        update({
                          redirectPolicy:
                            event.target.value === 'same_origin' ? 'same_origin' : 'none',
                        })
                      }
                    >
                      <option value="none">Não seguir</option>
                      <option value="same_origin" disabled={!native}>
                        Seguir apenas na mesma origem
                      </option>
                    </select>
                  </label>
                  <p>
                    {native
                      ? 'Uma mudança de protocolo, host ou porta encerra o redirecionamento.'
                      : 'Seguir redirecionamentos da mesma origem requer o app desktop.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
        {authConflict && (
          <div className="request-variable-warning" role="status">
            {authConflict}
          </div>
        )}
        <div className="request-context">
          <span>Ambiente ativo: {environment?.name ?? 'Nenhum'}</span>
          <button onClick={onSnippet}>
            Gerar código <ArrowUpRight size={12} />
          </button>
        </div>
        {(missing.length > 0 || references?.unclosed) && (
          <div className="request-variable-warning" role="status">
            {missing.length > 0 && (
              <div>Variáveis ausentes: {missing.map(({ name }) => name || '{{}}').join(', ')}</div>
            )}
            {references?.unclosed && <div>Feche cada referência com {'}}'}.</div>}
          </div>
        )}
        {!!references?.variables.length && (
          <details className="request-variables">
            <summary>Origem das variáveis ({references.variables.length})</summary>
            <dl>
              {references.variables.map(({ name, source }) => (
                <div key={name}>
                  <dt>
                    <code>{`{{${name}}}`}</code>
                  </dt>
                  <dd>
                    {source === 'environment'
                      ? environment?.name
                      : source === 'collection'
                        ? collection.name + ' (coleção)'
                        : 'Ausente'}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
      <section className="response-panel" aria-label="Resposta HTTP">
        <div className="response-heading">
          <div className="response-heading-left">
            <h3>Resposta</h3>
            {response && !busy && (
              <>
                <span className={`response-status ${response.status >= 400 ? 'status-error' : ''}`}>
                  <span className="status-dot" />
                  {response.status}{' '}
                  {(
                    {
                      200: 'OK',
                      201: 'Created',
                      204: 'No Content',
                      400: 'Bad Request',
                      401: 'Unauthorized',
                      404: 'Not Found',
                      500: 'Server Error',
                    } as Record<number, string>
                  )[response.status] || ''}
                </span>
                <span className="response-metric">
                  <Clock3 size={12} />
                  {response.duration_ms} ms
                </span>
                <span className="response-metric">
                  <Database size={12} />
                  {formatBytes(
                    response.size_bytes ?? new TextEncoder().encode(response.preview).length,
                  )}
                  {response.truncated && response.size_bytes === undefined && ' (prévia)'}
                </span>
              </>
            )}
          </div>
          <div className="response-actions">
            {response && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copy(response.preview)}
                  aria-label="Copiar prévia da resposta"
                >
                  <Copy size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={saveBody}
                  disabled={savingBody}
                  aria-label={
                    response.body_id ? 'Salvar corpo completo' : 'Salvar prévia da resposta'
                  }
                  title={response.body_id ? 'Salvar corpo completo' : 'Salvar prévia da resposta'}
                >
                  <ArrowDownToLine size={15} />
                </Button>
              </>
            )}
            <span className="response-indicator">
              <span className={cn('status-dot', busy && 'pulse')} />
              {busy ? 'Enviando' : response ? 'Recebida' : 'Aguardando'}
            </span>
          </div>
        </div>
        {busy ? (
          <div className="response-empty">
            <div className="response-art loading-art">
              <LoaderCircle className="spin" size={32} />
            </div>
            <h3>A caminho da sua API…</h3>
            <p>Preparando espaço para a próxima resposta.</p>
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancelar requisição
            </Button>
          </div>
        ) : error ? (
          <div className="response-error">
            <span className="error-icon">
              <TriangleAlert size={24} />
            </span>
            <div>
              <h3>Não foi dessa vez</h3>
              <p>{error}</p>
              <Button size="sm" variant="outline" onClick={onSend}>
                Tentar novamente <ArrowRight size={13} />
              </Button>
            </div>
          </div>
        ) : response ? (
          <>
            <div className="response-toolbar">
              <div
                className="response-tabs"
                role="tablist"
                aria-label="Visualização da resposta"
                onKeyDown={navigateTabs}
              >
                {[
                  { id: 'body', label: 'Corpo' },
                  { id: 'headers', label: 'Headers', count: response.headers.length },
                  { id: 'tests', label: 'Resultados dos testes', count: testResults.length },
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
                    {t.count !== undefined && <span className="tab-count">{t.count}</span>}
                  </button>
                ))}
              </div>
              {responseTab === 'body' && (
                <div className="format-select">
                  <select
                    aria-label="Formato da resposta"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    <option value="pretty">Formatado</option>
                    <option value="raw">Original</option>
                  </select>
                  <span>{json ? 'JSON' : 'Texto'}</span>
                </div>
              )}
            </div>
            {response.truncated && (
              <div className="truncated-banner">
                <Info size={14} /> Prévia limitada a 256 KiB.{' '}
                {response.body_id
                  ? 'O download inclui o corpo completo.'
                  : 'O download inclui a prévia.'}
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
                    key={`${request.id}-${response.duration_ms}`}
                    value={responseText}
                    json={json}
                    wrap={wrap}
                  />
                ) : (
                  <div className="small-empty">A resposta não contém corpo.</div>
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
                <div className="test-result-list">
                  {testResults.length ? (
                    testResults.map((test, i) => (
                      <div key={i}>
                        <span className={test.passed ? 'test-pass' : 'test-fail'}>
                          {test.passed ? <CheckCheck size={16} /> : <X size={16} />}
                          {test.passed ? 'PASSOU' : 'FALHOU'}
                        </span>
                        <code>{test.label}</code>
                      </div>
                    ))
                  ) : (
                    <div className="small-empty">
                      Adicione testes na configuração da requisição.
                    </div>
                  )}
                </div>
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
            <h3>Uma boa API começa com um olá.</h3>
            <p>Envie sua requisição e veja a resposta ganhar vida aqui.</p>
            <div className="empty-shortcut">
              <kbd>Ctrl</kbd>
              <span>+</span>
              <kbd>
                Enter <CornerDownLeft size={10} />
              </kbd>
              <span>para enviar</span>
            </div>
          </div>
        )}
      </section>
      <div className="editor-bottom-note">
        <LockKeyhole size={12} />
        <span>Suas APIs, seus dados. Tudo fica neste dispositivo.</span>
        <button onClick={onSnippet}>
          <Terminal size={12} /> cURL
        </button>
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
        <h3>Testes declarativos</h3>
        <span>Valide respostas sem precisar escrever scripts</span>
      </div>
      {request.tests.map((test, index) => (
        <div className="test-rule" key={index}>
          <span className="test-rule-icon">
            <Check size={13} />
          </span>
          <select
            className="input"
            aria-label={`Tipo do teste ${index + 1}`}
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
            <option value="status">Status HTTP</option>
            <option value="header">Header presente</option>
            <option value="header-value">Valor do header</option>
            <option value="json">Campo JSON</option>
          </select>
          {test.type === 'status' ? (
            <>
              <span>é igual a</span>
              <input
                className="input mono"
                aria-label="Status esperado"
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
                aria-label="Nome do header esperado"
                value={test.name}
                onChange={(e) => changeTest(index, { ...test, name: e.target.value })}
              />
              {test.equals !== undefined && (
                <input
                  className="input mono grow"
                  aria-label="Valor esperado do header"
                  placeholder="Valor exato"
                  value={test.equals}
                  onChange={(e) => changeTest(index, { ...test, equals: e.target.value })}
                />
              )}
            </>
          ) : (
            <>
              <input
                className="input mono"
                aria-label="JSON Pointer do teste"
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
            aria-label={`Excluir teste ${index + 1}`}
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
        <Plus size={14} /> Adicionar teste
      </Button>
      <details className="extraction-editor">
        <summary>
          <Settings2 size={14} /> Extrair variáveis da resposta <CircleHelp size={13} />
        </summary>
        <p>Mapeie nomes para JSON Pointers. Os valores são isolados por execução do runner.</p>
        <textarea
          aria-label="Extração de variáveis JSON"
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
              toast.error('Use um objeto JSON com nomes e JSON Pointers, como {"token":"/token"}.');
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
      aria-label="Valor JSON esperado"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        try {
          onChange(JSON.parse(text));
        } catch {
          toast.error('Informe um valor JSON válido: true, 123 ou "texto".');
          setText(JSON.stringify(value));
        }
      }}
    />
  );
}

export function curlFor(request: RequestItem, collection: Collection, environment?: Environment) {
  if (request.bodyType === 'binary' || request.bodyType === 'multipart')
    throw new Error('A geração de cURL para corpos com arquivos ainda não está disponível.');
  const headers = request.headers.map((row) =>
    isSecretHeader(row, collection, environment) && !/^\{\{[^{}]+\}\}$/.test(row.value)
      ? { ...row, value: '<segredo>' }
      : row,
  );
  const compiled = compileRequest(
    syncUrl({ ...request, headers }),
    collection,
    variablesFor(collection, environment),
    false,
  );
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
