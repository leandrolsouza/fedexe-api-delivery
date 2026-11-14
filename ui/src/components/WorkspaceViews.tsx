import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  Clock3,
  Copy,
  Database,
  FileJson2,
  FlaskConical,
  Globe2,
  HardDrive,
  History,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Moon,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Square,
  Sun,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  compileRequest,
  pair,
  redactSecrets,
  requestsForRun,
  safeEnvironment,
  exportableWorkspace,
  variablesFor,
  type Environment,
  type HistoryItem,
  type RunResult,
  type RunRow,
  type RunScope,
  type Workspace,
} from '../lib/models';
import { cn, download, uid } from '../lib/utils';
import { native, normalizeError, runCollection } from '../lib/transport';
import { PairEditor } from './PairEditor';
import { MethodBadge } from './RequestEditor';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Dropdown } from './ui/dropdown';

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

export function EnvironmentsView({
  workspace,
  onChange,
}: {
  workspace: Workspace;
  onChange: (workspace: Workspace) => void;
}) {
  const [selected, setSelected] = useState(
    workspace.activeEnvironment || workspace.environments[0]?.id || '',
  );
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  const environment = workspace.environments.find((e) => e.id === selected);
  const update = (patch: Partial<Environment>) =>
    onChange({
      ...workspace,
      environments: workspace.environments.map((env) =>
        env.id === selected ? { ...env, ...patch } : env,
      ),
    });
  function create() {
    if (!name.trim()) return;
    const env: Environment = {
      id: uid(),
      name: name.trim(),
      color: 'purple',
      variables: [pair('base_url', 'http://localhost:3000')],
    };
    onChange({ ...workspace, environments: [...workspace.environments, env] });
    setSelected(env.id);
    setCreating(false);
    setName('');
    toast.success('Ambiente criado');
  }
  return (
    <div className="workspace-page">
      <PageHeading
        eyebrow="CADA CONTEXTO, UM AMBIENTE"
        title="Mude o ambiente. Não o seu fluxo."
        description="As mesmas requisições, prontas para qualquer etapa do seu projeto."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> Novo ambiente
          </Button>
        }
      />
      <div className="stat-cards env-stat-cards">
        <div className="stat-card">
          <span className="stat-icon purple">
            <Globe2 size={20} />
          </span>
          <div>
            <span>Ambientes</span>
            <strong>
              {workspace.environments.length}
              <small>configurados</small>
            </strong>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon green">
            <Activity size={20} />
          </span>
          <div>
            <span>Ambiente ativo</span>
            <strong className="stat-word">
              {workspace.environments.find((e) => e.id === workspace.activeEnvironment)?.name ||
                'Nenhum'}
            </strong>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon amber">
            <LockKeyhole size={20} />
          </span>
          <div>
            <span>{native ? 'Segredos no cofre' : 'Segredos da sessão'}</span>
            <strong>
              {workspace.environments.reduce(
                (count, env) => count + env.variables.filter((v) => v.secret).length,
                0,
              )}
            </strong>
          </div>
        </div>
      </div>
      <div className="environment-layout">
        <aside className="environment-list">
          <div className="list-heading">
            SEUS AMBIENTES <span>{workspace.environments.length}</span>
          </div>
          {workspace.environments.map((env) => (
            <button
              key={env.id}
              className={cn('environment-list-item', selected === env.id && 'selected')}
              onClick={() => setSelected(env.id)}
            >
              <span className={cn('environment-icon', `env-${env.color}`)}>
                <Globe2 size={17} />
              </span>
              <span>
                <strong>{env.name}</strong>
                <small>{env.variables.length} variáveis</small>
              </span>
              {workspace.activeEnvironment === env.id ? (
                <span className="active-environment-label">Ativo</span>
              ) : (
                <ChevronRight size={15} />
              )}
            </button>
          ))}
          <Button variant="ghost" className="new-environment" onClick={() => setCreating(true)}>
            <Plus size={15} /> Adicionar ambiente
          </Button>
        </aside>
        {environment ? (
          <section className="environment-editor surface">
            <div className="surface-heading">
              <div>
                <div className="title-with-badge">
                  <input
                    className="section-name-input"
                    aria-label="Nome do ambiente"
                    value={environment.name}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                  <span className={`status-dot dot-${environment.color}`} />
                </div>
                <p>Use estas variáveis em URLs, headers, autorização e corpo.</p>
              </div>
              <div className="flex-items">
                {workspace.activeEnvironment !== selected && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onChange({ ...workspace, activeEnvironment: selected });
                      toast.success(`${environment.name} está ativo`);
                    }}
                  >
                    <Check size={14} /> Ativar ambiente
                  </Button>
                )}
                <Dropdown
                  trigger={
                    <Button variant="ghost" size="icon" aria-label="Ações do ambiente">
                      <MoreHorizontal size={18} />
                    </Button>
                  }
                  items={[
                    {
                      label: 'Duplicar ambiente',
                      icon: <Copy size={14} />,
                      action: () => {
                        const duplicate = {
                          ...environment,
                          id: uid(),
                          name: `${environment.name} (cópia)`,
                          variables: environment.variables.map((v) => ({ ...v, id: uid() })),
                        };
                        onChange({
                          ...workspace,
                          environments: [...workspace.environments, duplicate],
                        });
                        setSelected(duplicate.id);
                      },
                    },
                    {
                      label: 'Exportar estrutura',
                      icon: <ArrowDownToLine size={14} />,
                      action: () =>
                        download(
                          `${environment.name}.json`,
                          JSON.stringify(safeEnvironment(environment), null, 2),
                        ),
                    },
                    {
                      label: 'Excluir ambiente',
                      icon: <Trash2 size={14} />,
                      danger: true,
                      action: () => setConfirm(true),
                    },
                  ]}
                />
              </div>
            </div>
            <div className="environment-editor-body">
              <PairEditor
                key={environment.id}
                kind="variável"
                variables
                rows={environment.variables}
                onChange={(variables) => update({ variables })}
              />
              <div className="secret-notice">
                <LockKeyhole size={17} />
                <div>
                  <strong>Segredos de ambiente</strong>
                  <p>
                    {native
                      ? 'O cadeado guarda o valor no Gerenciador de Credenciais do Windows e o exclui das exportações.'
                      : 'O cadeado guarda o valor apenas na sessão e o exclui das exportações.'}
                  </p>
                </div>
              </div>
              <div className="precedence-note">
                <Info size={14} />
                <span>
                  Precedência no runner: extração temporária <ArrowRight size={11} /> ambiente{' '}
                  <ArrowRight size={11} /> coleção.
                </span>
              </div>
            </div>
            <div className="surface-footer">
              <span className="status-dot dot-green" /> Alterações salvas automaticamente neste
              dispositivo
            </div>
          </section>
        ) : (
          <div className="surface center-empty">
            <Globe2 size={32} />
            <h3>Um ambiente para começar</h3>
            <p>Separe configurações sem duplicar suas requisições.</p>
            <Button onClick={() => setCreating(true)}>Criar ambiente</Button>
          </div>
        )}
      </div>
      <div className="wide-tip">
        <span className="wide-tip-icon">
          <Terminal size={21} />
        </span>
        <div>
          <h4>Uma URL, infinitas possibilidades.</h4>
          <p>
            Troque <code>http://localhost:3000</code> por <code>{'{{base_url}}'}</code> e deixe o
            ambiente cuidar do resto.
          </p>
        </div>
        <span className="wide-tip-decoration">{'{{ }}'}</span>
      </div>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Novo ambiente"
        description="Dê um nome ao próximo contexto da sua API."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label className="field-label">
            Nome do ambiente
            <input
              autoFocus
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Produção"
              required
              maxLength={80}
            />
          </label>
          <div className="dialog-footer">
            <Button variant="outline" type="button" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit">
              Criar ambiente <ArrowRight size={14} />
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Excluir ambiente?"
        description={`O ambiente ${environment?.name} será removido deste dispositivo.`}
      >
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setConfirm(false)}>
            Manter ambiente
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const remaining = workspace.environments.filter((e) => e.id !== selected);
              onChange({
                ...workspace,
                environments: remaining,
                activeEnvironment:
                  workspace.activeEnvironment === selected
                    ? remaining[0]?.id || ''
                    : workspace.activeEnvironment,
              });
              setSelected(remaining[0]?.id || '');
              setConfirm(false);
            }}
          >
            Excluir ambiente
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function RunnerView({
  workspace,
  busy,
  setBusy,
  onCancel,
  onResults,
}: {
  workspace: Workspace;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onCancel: () => void;
  onResults: (result: RunResult) => void;
}) {
  const [collectionId, setCollectionId] = useState(workspace.collections[0]?.id || '');
  const collection =
    workspace.collections.find((c) => c.id === collectionId) ?? workspace.collections[0];
  const [environmentId, setEnvironmentId] = useState('');
  const [scope, setScope] = useState<RunScope>('collection');
  const [folder, setFolder] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [runRequestIds, setRunRequestIds] = useState<string[]>([]);
  const [activeStep, setActiveStep] = useState<number>();
  const [rows, setRows] = useState<RunRow[]>([]);
  const [result, setResult] = useState<RunResult>();
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const environment = workspace.environments.find((env) => env.id === environmentId);
  const chosen = requestsForRun(collection, scope, folder, selection);
  const chosenIds = new Set(chosen.map(({ id }) => id));
  const resultsById = new Map(rows.map((row, index) => [runRequestIds[index], row]));
  const activeRequestId = activeStep === undefined ? undefined : runRequestIds[activeStep];
  const activeRequest = collection?.requests.find(({ id }) => id === activeRequestId);
  const totalSteps = runRequestIds.length;
  const passed = rows.filter((r) => !r.failures.length).length;
  const failed = rows.filter((r) => r.failures.length).length;
  const completedLabel = `${rows.length} de ${totalSteps} ${totalSteps === 1 ? 'etapa concluída' : 'etapas concluídas'}`;
  const approvedLabel = passed === 1 ? 'aprovada' : 'aprovadas';
  const chosenLabel = `${chosen.length} ${chosen.length === 1 ? 'etapa' : 'etapas'}`;
  const latest = rows.at(-1);
  const outcomeLabel = {
    completed: 'Execução concluída',
    cancelled: 'Execução cancelada',
    stopped_on_failure: 'Execução interrompida na primeira falha',
  };
  const maxHttpTime = rows.reduce((max, row) => Math.max(max, row.http_ms), 1);
  function clearRun() {
    setRows([]);
    setRunRequestIds([]);
    setActiveStep(undefined);
    setResult(undefined);
    setError('');
    setCancelling(false);
  }
  async function run() {
    if (!collection || !chosen.length || !environment || busy) return;
    setBusy(true);
    setRunning(true);
    clearRun();
    setRunRequestIds(chosen.map(({ id }) => id));
    try {
      const snapshot = structuredClone({
        collection,
        environment,
        requests: chosen,
      });
      const variables = variablesFor(snapshot.collection, snapshot.environment);
      const nativeCollection = {
        stop_on_failure: stopOnFailure,
        variables,
        requests: snapshot.requests.map((item) => {
          const step = { name: item.name, tests: item.tests, extract: item.extract };
          try {
            return {
              ...step,
              request: compileRequest(item, snapshot.collection, variables, false, true),
            };
          } catch (error) {
            return { ...step, preparation_error: normalizeError(error).message };
          }
        }),
      };
      const redactRows = (rows: RunRow[]) =>
        rows.map((row) => ({
          ...row,
          failures: row.failures.map((message) => redactSecrets(message, snapshot.environment)),
        }));
      const outcome = await runCollection(nativeCollection, (event) => {
        if (event.type === 'started') {
          setActiveStep(event.index);
        } else {
          const [row] = redactRows([event.row]);
          setRows((current) => [...current, row]);
          setActiveStep((current) => (current === event.index ? undefined : current));
        }
      });
      const result = { ...outcome, results: redactRows(outcome.results) };
      setRows(result.results);
      setResult(result);
      onResults(result);
      if (result.outcome === 'completed')
        toast[result.results.some((r) => r.failures.length) ? 'warning' : 'success'](
          'Execução concluída',
        );
    } catch (error) {
      setError(redactSecrets(normalizeError(error).message, environment));
    } finally {
      setCancelling(false);
      setActiveStep(undefined);
      setRunning(false);
      setBusy(false);
    }
  }
  return (
    <div className="workspace-page runner-page">
      <PageHeading
        eyebrow="CONFIANÇA EM CADA ENTREGA"
        title="Teste o fluxo. Não só o endpoint."
        description="Execute suas coleções em sequência e encontre os detalhes que fazem a diferença."
        action={
          <span className="local-pill">
            <ShieldCheck size={14} /> Execução local
          </span>
        }
      />
      <div className="runner-layout">
        <section className="surface runner-configuration">
          <div className="surface-heading">
            <div>
              <h3>Configurar execução</h3>
              <p>Um fluxo, do início ao fim.</p>
            </div>
            <span className="section-icon">
              <FlaskConical size={20} />
            </span>
          </div>
          <div className="runner-fields">
            <label className="field-label">
              Coleção
              <select
                aria-label="Coleção"
                disabled={busy}
                className="input"
                value={collection?.id ?? ''}
                onChange={(e) => {
                  setCollectionId(e.target.value);
                  setFolder('');
                  setSelection([]);
                  clearRun();
                }}
              >
                <option value="" disabled>
                  Selecione uma coleção
                </option>
                {workspace.collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Ambiente de execução
              <select
                disabled={busy}
                className="input"
                value={environment?.id ?? ''}
                onChange={(e) => {
                  setEnvironmentId(e.target.value);
                  clearRun();
                }}
              >
                <option value="">Selecione um ambiente</option>
                {workspace.environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Escopo da execução
              <select
                className="input"
                value={scope}
                disabled={busy}
                onChange={(event) => {
                  setScope(event.target.value as RunScope);
                  clearRun();
                }}
              >
                <option value="collection">Coleção inteira</option>
                <option value="folder">Pasta</option>
                <option value="selection">Requisições selecionadas</option>
              </select>
            </label>
            {scope === 'folder' && (
              <label className="field-label">
                Pasta da coleção
                <select
                  className="input"
                  disabled={busy}
                  value={collection?.folders.includes(folder) ? folder : ''}
                  onChange={(event) => {
                    setFolder(event.target.value);
                    clearRun();
                  }}
                >
                  <option value="">Selecione uma pasta</option>
                  {collection?.folders.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="runner-mode">
              <span className="status-dot dot-purple" />
              <strong>Sequencial</strong>
              <span>Uma requisição por vez</span>
            </div>
            <label className="field-label">
              Ao encontrar uma falha
              <select
                className="input"
                disabled={busy}
                value={stopOnFailure ? 'stop' : 'continue'}
                onChange={(event) => setStopOnFailure(event.target.value === 'stop')}
              >
                <option value="continue">Continuar até o fim</option>
                <option value="stop">Parar na primeira falha</option>
              </select>
            </label>
            <p className="field-hint">
              O runner usa as requisições salvas. Salve suas alterações no editor antes de executar.
            </p>
          </div>
          <div className="runner-start">
            {running ? (
              <Button
                variant="secondary"
                disabled={cancelling}
                onClick={() => {
                  setCancelling(true);
                  onCancel();
                }}
              >
                <Square size={14} /> {cancelling ? 'Cancelando…' : 'Cancelar execução'}
              </Button>
            ) : (
              <Button onClick={run} disabled={busy || !chosen.length || !environment}>
                <Play size={15} fill="currentColor" /> Executar {chosen.length}{' '}
                {chosen.length === 1 ? 'requisição' : 'requisições'}
              </Button>
            )}
            <span>
              <LockKeyhole size={11} /> Variáveis isoladas por rodada
            </span>
          </div>
        </section>
        <section className="surface runner-results">
          <div className="surface-heading">
            <div>
              <h3>
                {running
                  ? 'Execução em andamento'
                  : result
                    ? outcomeLabel[result.outcome]
                    : 'Requisições da coleção'}
              </h3>
              <p role="status" aria-atomic="true">
                {running
                  ? activeStep !== undefined && activeRequest
                    ? `Etapa ${activeStep + 1} de ${totalSteps} · ${activeRequest.name}`
                    : completedLabel
                  : result
                    ? `${outcomeLabel[result.outcome]} · ${completedLabel} · ${passed} ${approvedLabel} · ${failed} com falha`
                    : `${chosenLabel} · na ordem definida na coleção`}
                {latest &&
                  ` · Última etapa: ${latest.name} · ${latest.failures.length ? 'Falhou' : 'Aprovada'} · ${latest.http_ms + latest.validation_ms} ms`}
              </p>
            </div>
            {running ? (
              <LoaderCircle className="spin purple-text" size={20} />
            ) : (
              <span className="subtle-badge">
                {result
                  ? `${rows.length} ${rows.length === 1 ? 'etapa concluída' : 'etapas concluídas'}`
                  : chosenLabel}
              </span>
            )}
          </div>
          {(running || rows.length > 0 || result) && (
            <div className="run-summary">
              <span>
                <CircleCheck size={15} className="green-text" />
                <strong>{passed}</strong> {approvedLabel}
              </span>
              <span>
                <TriangleAlert size={15} className={failed ? 'red-text' : ''} />
                <strong>{failed}</strong> com falha
              </span>
              <span>
                <Clock3 size={15} />
                <strong>
                  {result?.duration_ms ??
                    rows.reduce((sum, row) => sum + row.http_ms + row.validation_ms, 0)}
                </strong>{' '}
                ms
              </span>
            </div>
          )}
          {error && (
            <div className="inline-error">
              <TriangleAlert size={16} />
              {error}
            </div>
          )}
          <div className="runner-request-list">
            {collection?.requests.map((request, index) => {
              const row = resultsById.get(request.id);
              const included = chosenIds.has(request.id);
              const active = running && request.id === activeRequestId;
              return (
                <div
                  className={cn('runner-request-row', !included && 'excluded', active && 'active')}
                  aria-current={active ? 'step' : undefined}
                  key={request.id}
                >
                  <input
                    type="checkbox"
                    aria-label={`Executar ${request.name}`}
                    disabled={busy || scope !== 'selection'}
                    checked={included}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelection((current) =>
                        checked
                          ? [...current, request.id]
                          : current.filter((id) => id !== request.id),
                      );
                      clearRun();
                    }}
                  />
                  <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
                  <MethodBadge method={request.method} small />
                  <div className="runner-request-name">
                    <strong>{request.name}</strong>
                    <code>{request.url.replace('{{base_url}}', '')}</code>
                    {row?.failures.map((failure, i) => (
                      <p className="run-failure" key={i}>
                        {failure}
                      </p>
                    ))}
                  </div>
                  {row ? (
                    <div className="run-row-result">
                      <span className={row.failures.length ? 'red-text' : 'green-text'}>
                        {row.failures.length ? <X size={14} /> : <Check size={14} />}
                        {row.failures.length ? 'Falhou' : 'Aprovada'}
                        {row.status !== null && ` · ${row.status}`}
                      </span>
                      <small>{row.http_ms + row.validation_ms} ms</small>
                    </div>
                  ) : (
                    <span className={cn('pending-label', active && 'purple-text')}>
                      {!included
                        ? 'Ignorada'
                        : active
                          ? 'Em execução'
                          : running
                            ? 'Pendente'
                            : result
                              ? 'Não executada'
                              : `${request.tests.length} testes`}
                    </span>
                  )}
                </div>
              );
            })}
            {!collection?.requests.length && (
              <div className="center-empty">
                <Layers3 size={30} />
                <h3>Nenhuma requisição por aqui</h3>
                <p>Adicione endpoints à sua coleção para começar.</p>
              </div>
            )}
          </div>
          {running && (
            <div
              className="run-progress"
              role="progressbar"
              aria-label="Etapas concluídas"
              aria-valuenow={rows.length}
              aria-valuemax={totalSteps || 1}
            >
              <div
                style={{
                  width: `${totalSteps ? (rows.length / totalSteps) * 100 : 0}%`,
                }}
              />
            </div>
          )}
          {rows.length > 0 && (
            <div className="run-timing">
              <h4>
                <Activity size={14} /> Tempo por etapa
              </h4>
              <div className="timing-bars">
                {rows.map((row, i) => (
                  <div key={i} title={`${row.name}: ${row.http_ms} ms`}>
                    <span
                      style={{
                        height: `${Math.max(8, (row.http_ms / maxHttpTime) * 100)}%`,
                      }}
                      className={row.failures.length ? 'failed' : ''}
                    />
                    <small>{i + 1}</small>
                  </div>
                ))}
              </div>
              <div className="timing-caption">Duração HTTP relativa por requisição</div>
              {result && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    download(
                      `execucao-${new Date().toISOString().slice(0, 10)}.json`,
                      JSON.stringify(result, null, 2),
                    )
                  }
                >
                  <ArrowDownToLine size={14} /> Exportar relatório
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
      <div className="runner-footnote">
        <Info size={14} /> O ambiente é capturado no início. Tokens extraídos só existem durante
        esta execução.
      </div>
    </div>
  );
}

export function HistoryView({
  history,
  onOpen,
  onClear,
}: {
  history: HistoryItem[];
  onOpen: (item: HistoryItem) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [confirm, setConfirm] = useState(false);
  const rows = history.filter(
    (row) =>
      `${row.name} ${row.url} ${row.method}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'success'
          ? row.status !== null && row.status < 400
          : row.status === null || row.status >= 400)),
  );
  const average = history.length
    ? Math.round(history.reduce((sum, row) => sum + row.duration, 0) / history.length)
    : 0;
  return (
    <div className="workspace-page">
      <PageHeading
        eyebrow="CADA REQUEST CONTA UMA HISTÓRIA"
        title="Seu caminho até aqui."
        description="Revisite as requisições que você enviou, sem perder o fio da meada."
        action={
          <Button variant="outline" disabled={!history.length} onClick={() => setConfirm(true)}>
            <Trash2 size={14} /> Limpar histórico
          </Button>
        }
      />
      <div className="stat-cards">
        <div className="stat-card">
          <span className="stat-icon purple">
            <History size={20} />
          </span>
          <div>
            <span>Requisições enviadas</span>
            <strong>{history.length}</strong>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon green">
            <CheckCheck size={20} />
          </span>
          <div>
            <span>Respostas de sucesso</span>
            <strong>{history.filter((r) => r.status !== null && r.status < 400).length}</strong>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon amber">
            <Clock3 size={20} />
          </span>
          <div>
            <span>Tempo médio</span>
            <strong>
              {average}
              <small>ms</small>
            </strong>
          </div>
        </div>
      </div>
      <section className="surface history-surface">
        <div className="history-toolbar">
          <div className="search-field">
            <Search size={15} />
            <input
              aria-label="Buscar no histórico"
              placeholder="Buscar requisições…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="segmented-control">
            {[
              { id: 'all', label: 'Todas' },
              { id: 'success', label: 'Sucesso' },
              { id: 'error', label: 'Erros' },
            ].map((tab) => (
              <button
                className={filter === tab.id ? 'active' : ''}
                key={tab.id}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="muted">{rows.length} resultados</span>
        </div>
        {rows.length ? (
          <div className="history-table">
            <div className="history-row history-table-heading">
              <span>REQUISIÇÃO</span>
              <span>STATUS</span>
              <span>TEMPO</span>
              <span>QUANDO</span>
              <span />
            </div>
            {rows.map((row) => (
              <button className="history-row" key={row.id} onClick={() => onOpen(row)}>
                <span className="history-request">
                  <MethodBadge method={row.method} small />
                  <span>
                    <strong>{row.name}</strong>
                    <code>{row.url}</code>
                  </span>
                </span>
                <span
                  className={cn(
                    'history-status',
                    row.status !== null && row.status < 400 ? 'good' : 'bad',
                  )}
                >
                  <span className="status-dot" />
                  {row.status || 'Erro de rede'}
                </span>
                <span className="mono">{row.duration} ms</span>
                <span>
                  {new Date(row.date).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <div className="center-empty tall-empty">
            <span className="empty-page-icon">
              <History size={34} strokeWidth={1.5} />
            </span>
            <h3>
              {search || filter !== 'all'
                ? 'Nenhum resultado encontrado'
                : 'Toda jornada tem um primeiro request.'}
            </h3>
            <p>
              {search || filter !== 'all'
                ? 'Experimente outros termos ou altere o filtro.'
                : 'As requisições enviadas pelo editor vão aparecer aqui.'}
            </p>
            <span className="privacy-note">
              <LockKeyhole size={12} /> Apenas metadados. Corpos e credenciais não entram no
              histórico.
            </span>
          </div>
        )}
      </section>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Limpar o histórico?"
        description="Os metadados das requisições serão removidos. Suas coleções não serão afetadas."
      >
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setConfirm(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onClear();
              setConfirm(false);
              toast.success('Histórico limpo');
            }}
          >
            Limpar histórico
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function SettingsView({
  workspace,
  onChange,
  onImport,
  onHelp,
}: {
  workspace: Workspace;
  onChange: (workspace: Workspace) => void;
  onImport: () => void;
  onHelp: () => void;
}) {
  const settings = workspace.settings;
  const update = (patch: Partial<Workspace['settings']>) =>
    onChange({ ...workspace, settings: { ...settings, ...patch } });
  const size = useMemo(
    () => new TextEncoder().encode(JSON.stringify(workspace)).length,
    [workspace],
  );
  return (
    <div className="workspace-page settings-page">
      <PageHeading
        eyebrow="DO SEU JEITO"
        title="Um workspace com a sua cara."
        description="Ajuste os detalhes e deixe o Fedexe trabalhar no seu ritmo."
      />
      <section className="surface settings-surface">
        <div className="settings-section-heading">
          <Monitor size={20} />
          <div>
            <h3>Aparência</h3>
            <p>Conforto visual para cada momento do dia.</p>
          </div>
        </div>
        <div className="theme-options">
          {(
            [
              { value: 'light', label: 'Claro', icon: Sun },
              { value: 'dark', label: 'Escuro', icon: Moon },
              { value: 'system', label: 'Sistema', icon: Monitor },
            ] as const
          ).map((theme) => (
            <button
              key={theme.value}
              className={cn('theme-option', settings.theme === theme.value && 'selected')}
              onClick={() => update({ theme: theme.value })}
            >
              <div className={`theme-preview preview-${theme.value}`}>
                <i />
                <span />
                <span />
                <span />
              </div>
              <span>
                <theme.icon size={15} />
                {theme.label}
                {settings.theme === theme.value && <Check size={15} />}
              </span>
            </button>
          ))}
        </div>
        <SettingToggle
          title="Interface compacta"
          description="Reduza os espaçamentos na árvore de coleções."
          checked={settings.compact}
          onChange={(compact) => update({ compact })}
        />
        <SettingToggle
          title="Quebra de linha nas respostas"
          description="Leia respostas longas sem rolar horizontalmente."
          checked={settings.wrap}
          onChange={(wrap) => update({ wrap })}
        />
      </section>
      <section className="surface settings-surface">
        <div className="settings-section-heading">
          <HardDrive size={20} />
          <div>
            <h3>Seu espaço, seus dados</h3>
            <p>Sem nuvem obrigatória. Sem contas. Sem surpresas.</p>
          </div>
        </div>
        <label className="field-label workspace-name-field">
          Nome do workspace
          <input
            className="input"
            maxLength={60}
            value={settings.workspaceName}
            onChange={(e) => update({ workspaceName: e.target.value })}
          />
        </label>
        <div className="data-information">
          <span>
            <Database size={16} /> Armazenamento local
          </span>
          <strong>{(size / 1024).toFixed(1)} KB</strong>
        </div>
        <div className="settings-backup-actions">
          <Button
            variant="outline"
            onClick={() =>
              download(
                `fedexe-backup-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(exportableWorkspace(workspace), null, 2),
              )
            }
          >
            <ArrowDownToLine size={15} /> Exportar backup
          </Button>
          <Button variant="outline" onClick={onImport}>
            <FileJson2 size={15} /> Importar dados
          </Button>
        </div>
        <p className="field-hint">
          {native
            ? 'O workspace é salvo em JSON. Segredos marcados ficam no Gerenciador de Credenciais do Windows.'
            : 'O navegador salva o workspace localmente e mantém os segredos apenas na sessão.'}
        </p>
      </section>
      <section className="about-card">
        <span className="brand-mark">
          f<span>↗</span>
        </span>
        <div>
          <h3>Feito para quem constrói.</h3>
          <p>Fedexe API · Interface 0.2 · MIT · Local-first</p>
        </div>
        <Button variant="outline" onClick={onHelp}>
          Conhecer o projeto <ArrowUpRight size={14} />
        </Button>
      </section>
    </div>
  );
}

function SettingToggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="setting-toggle">
      <div>
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={title}
        className={cn('switch', checked && 'checked')}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}
