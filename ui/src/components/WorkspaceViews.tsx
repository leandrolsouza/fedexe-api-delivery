import { formatDate, formatNumber, setLocale, t, useLocale, type Locale } from '../lib/i18n';
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
  pair,
  redactSecrets,
  requestsForRun,
  safeEnvironment,
  exportableWorkspace,
  type Environment,
  type HistoryItem,
  type RunResult,
  type RunRow,
  type RunScope,
  type Workspace,
} from '../lib/models';
import { prepareCollection } from '../lib/collection-runner';
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
    toast.success(t('Ambiente criado'));
  }
  return (
    <div className="workspace-page">
      <PageHeading
        eyebrow={t('CADA CONTEXTO, UM AMBIENTE')}
        title={t('Mude o ambiente. Não o seu fluxo.')}
        description={t('As mesmas requisições, prontas para qualquer etapa do seu projeto.')}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            {' ' + t('Novo ambiente')}
          </Button>
        }
      />
      <div className="stat-cards env-stat-cards">
        <div className="stat-card">
          <span className="stat-icon purple">
            <Globe2 size={20} />
          </span>
          <div>
            <span>{t('Ambientes')}</span>
            <strong>
              {formatNumber(workspace.environments.length)}
              <small>{t('configurados')}</small>
            </strong>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon green">
            <Activity size={20} />
          </span>
          <div>
            <span>{t('Ambiente ativo')}</span>
            <strong className="stat-word">
              {workspace.environments.find((e) => e.id === workspace.activeEnvironment)?.name ||
                t('Nenhum')}
            </strong>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon amber">
            <LockKeyhole size={20} />
          </span>
          <div>
            <span>{native ? t('Segredos no cofre') : t('Segredos da sessão')}</span>
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
            {t('SEUS AMBIENTES') + ' '}
            <span>{formatNumber(workspace.environments.length)}</span>
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
                <small>
                  {formatNumber(env.variables.length)}
                  {' ' + t('variáveis')}
                </small>
              </span>
              {workspace.activeEnvironment === env.id ? (
                <span className="active-environment-label">{t('Ativo')}</span>
              ) : (
                <ChevronRight size={15} />
              )}
            </button>
          ))}
          <Button variant="ghost" className="new-environment" onClick={() => setCreating(true)}>
            <Plus size={15} />
            {' ' + t('Adicionar ambiente')}
          </Button>
        </aside>
        {environment ? (
          <section className="environment-editor surface">
            <div className="surface-heading">
              <div>
                <div className="title-with-badge">
                  <input
                    className="section-name-input"
                    aria-label={t('Nome do ambiente')}
                    value={environment.name}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                  <span className={`status-dot dot-${environment.color}`} />
                </div>
                <p>{t('Use estas variáveis em URLs, headers, autorização e corpo.')}</p>
              </div>
              <div className="flex-items">
                {workspace.activeEnvironment !== selected && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onChange({ ...workspace, activeEnvironment: selected });
                      toast.success(t('{0} está ativo', environment.name));
                    }}
                  >
                    <Check size={14} />
                    {' ' + t('Ativar ambiente')}
                  </Button>
                )}
                <Dropdown
                  trigger={
                    <Button variant="ghost" size="icon" aria-label={t('Ações do ambiente')}>
                      <MoreHorizontal size={18} />
                    </Button>
                  }
                  items={[
                    {
                      label: t('Duplicar ambiente'),
                      icon: <Copy size={14} />,
                      action: () => {
                        const duplicate = {
                          ...environment,
                          id: uid(),
                          name: t('{0} (cópia)', environment.name),
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
                      label: t('Exportar estrutura'),
                      icon: <ArrowDownToLine size={14} />,
                      action: () =>
                        download(
                          `${environment.name}.json`,
                          JSON.stringify(safeEnvironment(environment), null, 2),
                        ),
                    },
                    {
                      label: t('Excluir ambiente'),
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
                kind={t('variável')}
                variables
                rows={environment.variables}
                onChange={(variables) => update({ variables })}
              />
              <div className="secret-notice">
                <LockKeyhole size={17} />
                <div>
                  <strong>{t('Segredos de ambiente')}</strong>
                  <p>
                    {native
                      ? t(
                          'O cadeado guarda o valor no Gerenciador de Credenciais do Windows e o exclui das exportações.',
                        )
                      : t('O cadeado guarda o valor apenas na sessão e o exclui das exportações.')}
                  </p>
                </div>
              </div>
              <div className="precedence-note">
                <Info size={14} />
                <span>
                  {t('Precedência no runner: extração temporária') + ' '}
                  <ArrowRight size={11} />
                  {' ' + t('ambiente')} <ArrowRight size={11} />
                  {' ' + t('coleção.')}
                </span>
              </div>
            </div>
            <div className="surface-footer">
              <span className="status-dot dot-green" />
              {' ' + t('Alterações salvas automaticamente neste dispositivo')}
            </div>
          </section>
        ) : (
          <div className="surface center-empty">
            <Globe2 size={32} />
            <h3>{t('Um ambiente para começar')}</h3>
            <p>{t('Separe configurações sem duplicar suas requisições.')}</p>
            <Button onClick={() => setCreating(true)}>{t('Criar ambiente')}</Button>
          </div>
        )}
      </div>
      <div className="wide-tip">
        <span className="wide-tip-icon">
          <Terminal size={21} />
        </span>
        <div>
          <h4>{t('Uma URL, infinitas possibilidades.')}</h4>
          <p>
            {t('Troque') + ' '}
            <code>http://localhost:3000</code>
            {' ' + t('por') + ' '}
            <code>{'{{base_url}}'}</code>
            {' ' + t('e deixe o ambiente cuidar do resto.')}
          </p>
        </div>
        <span className="wide-tip-decoration">{'{{ }}'}</span>
      </div>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title={t('Novo ambiente')}
        description={t('Dê um nome ao próximo contexto da sua API.')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label className="field-label">
            {t('Nome do ambiente')}
            <input
              autoFocus
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Ex.: Produção')}
              required
              maxLength={80}
            />
          </label>
          <div className="dialog-footer">
            <Button variant="outline" type="button" onClick={() => setCreating(false)}>
              {t('Cancelar')}
            </Button>
            <Button type="submit">
              {t('Criar ambiente') + ' '}
              <ArrowRight size={14} />
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('Excluir ambiente?')}
        description={t('O ambiente {0} será removido deste dispositivo.', environment?.name ?? '')}
      >
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setConfirm(false)}>
            {t('Manter ambiente')}
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
            {t('Excluir ambiente')}
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
  const completedLabel = t(
    '{0} de {1} {2}',
    rows.length,
    totalSteps,
    totalSteps === 1 ? t('etapa concluída') : t('etapas concluídas'),
  );
  const approvedLabel = passed === 1 ? t('aprovada') : t('aprovadas');
  const chosenLabel = t('{0} {1}', chosen.length, chosen.length === 1 ? t('etapa') : t('etapas'));
  const latest = rows.at(-1);
  const outcomeLabel = {
    completed: t('Execução concluída'),
    cancelled: t('Execução cancelada'),
    stopped_on_failure: t('Execução interrompida na primeira falha'),
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
      const nativeCollection = prepareCollection(
        snapshot.collection,
        snapshot.environment,
        snapshot.requests,
        stopOnFailure,
      );
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
          t('Execução concluída'),
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
        eyebrow={t('CONFIANÇA EM CADA ENTREGA')}
        title={t('Teste o fluxo. Não só o endpoint.')}
        description={t(
          'Execute suas coleções em sequência e encontre os detalhes que fazem a diferença.',
        )}
        action={
          <span className="local-pill">
            <ShieldCheck size={14} />
            {' ' + t('Execução local')}
          </span>
        }
      />
      <div className="runner-layout">
        <section className="surface runner-configuration">
          <div className="surface-heading">
            <div>
              <h3>{t('Configurar execução')}</h3>
              <p>{t('Um fluxo, do início ao fim.')}</p>
            </div>
            <span className="section-icon">
              <FlaskConical size={20} />
            </span>
          </div>
          <div className="runner-fields">
            <label className="field-label">
              {t('Coleção')}
              <select
                aria-label={t('Coleção')}
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
                  {t('Selecione uma coleção')}
                </option>
                {workspace.collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              {t('Ambiente de execução')}
              <select
                disabled={busy}
                className="input"
                value={environment?.id ?? ''}
                onChange={(e) => {
                  setEnvironmentId(e.target.value);
                  clearRun();
                }}
              >
                <option value="">{t('Selecione um ambiente')}</option>
                {workspace.environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              {t('Escopo da execução')}
              <select
                className="input"
                value={scope}
                disabled={busy}
                onChange={(event) => {
                  setScope(event.target.value as RunScope);
                  clearRun();
                }}
              >
                <option value="collection">{t('Coleção inteira')}</option>
                <option value="folder">{t('Pasta')}</option>
                <option value="selection">{t('Requisições selecionadas')}</option>
              </select>
            </label>
            {scope === 'folder' && (
              <label className="field-label">
                {t('Pasta da coleção')}
                <select
                  className="input"
                  disabled={busy}
                  value={collection?.folders.includes(folder) ? folder : ''}
                  onChange={(event) => {
                    setFolder(event.target.value);
                    clearRun();
                  }}
                >
                  <option value="">{t('Selecione uma pasta')}</option>
                  {collection?.folders.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="runner-mode">
              <span className="status-dot dot-purple" />
              <strong>{t('Sequencial')}</strong>
              <span>{t('Uma requisição por vez')}</span>
            </div>
            <label className="field-label">
              {t('Ao encontrar uma falha')}
              <select
                className="input"
                disabled={busy}
                value={stopOnFailure ? 'stop' : 'continue'}
                onChange={(event) => setStopOnFailure(event.target.value === 'stop')}
              >
                <option value="continue">{t('Continuar até o fim')}</option>
                <option value="stop">{t('Parar na primeira falha')}</option>
              </select>
            </label>
            <p className="field-hint">
              {t(
                'O runner usa as requisições salvas. Salve suas alterações no editor antes de executar.',
              )}
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
                <Square size={14} /> {cancelling ? t('Cancelando…') : t('Cancelar execução')}
              </Button>
            ) : (
              <Button onClick={run} disabled={busy || !chosen.length || !environment}>
                <Play size={15} fill="currentColor" />
                {' ' + t('Executar') + ' '}
                {formatNumber(chosen.length)}{' '}
                {chosen.length === 1 ? t('requisição') : t('requisições')}
              </Button>
            )}
            <span>
              <LockKeyhole size={11} />
              {' ' + t('Variáveis isoladas por rodada')}
            </span>
          </div>
        </section>
        <section className="surface runner-results">
          <div className="surface-heading">
            <div>
              <h3>
                {running
                  ? t('Execução em andamento')
                  : result
                    ? outcomeLabel[result.outcome]
                    : t('Requisições da coleção')}
              </h3>
              <p role="status" aria-atomic="true">
                {running
                  ? activeStep !== undefined && activeRequest
                    ? t('Etapa {0} de {1} · {2}', activeStep + 1, totalSteps, activeRequest.name)
                    : completedLabel
                  : result
                    ? t(
                        '{0} · {1} · {2} {3} · {4} com falha',
                        outcomeLabel[result.outcome],
                        completedLabel,
                        passed,
                        approvedLabel,
                        failed,
                      )
                    : t('{0} · na ordem definida na coleção', chosenLabel)}
                {latest &&
                  t(
                    ' · Última etapa: {0} · {1} · {2} ms',
                    latest.name,
                    latest.failures.length ? t('Falhou') : t('Aprovada'),
                    latest.http_ms + latest.validation_ms,
                  )}
              </p>
            </div>
            {running ? (
              <LoaderCircle className="spin purple-text" size={20} />
            ) : (
              <span className="subtle-badge">
                {result
                  ? t(
                      '{0} {1}',
                      rows.length,
                      rows.length === 1 ? t('etapa concluída') : t('etapas concluídas'),
                    )
                  : chosenLabel}
              </span>
            )}
          </div>
          {(running || rows.length > 0 || result) && (
            <div className="run-summary">
              <span>
                <CircleCheck size={15} className="green-text" />
                <strong>{formatNumber(passed)}</strong> {approvedLabel}
              </span>
              <span>
                <TriangleAlert size={15} className={failed ? 'red-text' : ''} />
                <strong>{formatNumber(failed)}</strong>
                {' ' + t('com falha')}
              </span>
              <span>
                <Clock3 size={15} />
                <strong>
                  {formatNumber(
                    result?.duration_ms ??
                      rows.reduce((sum, row) => sum + row.http_ms + row.validation_ms, 0),
                  )}
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
                    aria-label={t('Executar {0}', request.name)}
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
                  <span className="step-number">
                    {formatNumber(index + 1, { minimumIntegerDigits: 2 })}
                  </span>
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
                        {row.failures.length ? t('Falhou') : t('Aprovada')}
                        {row.status !== null && ` · ${row.status}`}
                      </span>
                      <small>{formatNumber(row.http_ms + row.validation_ms)} ms</small>
                    </div>
                  ) : (
                    <span className={cn('pending-label', active && 'purple-text')}>
                      {!included
                        ? t('Ignorada')
                        : active
                          ? t('Em execução')
                          : running
                            ? t('Pendente')
                            : result
                              ? t('Não executada')
                              : t('{0} testes', request.tests.length)}
                    </span>
                  )}
                </div>
              );
            })}
            {!collection?.requests.length && (
              <div className="center-empty">
                <Layers3 size={30} />
                <h3>{t('Nenhuma requisição por aqui')}</h3>
                <p>{t('Adicione endpoints à sua coleção para começar.')}</p>
              </div>
            )}
          </div>
          {running && (
            <div
              className="run-progress"
              role="progressbar"
              aria-label={t('Etapas concluídas')}
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
                <Activity size={14} />
                {' ' + t('Tempo por etapa')}
              </h4>
              <div className="timing-bars">
                {rows.map((row, i) => (
                  <div key={i} title={t('{0}: {1} ms', row.name, row.http_ms)}>
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
              <div className="timing-caption">{t('Duração HTTP relativa por requisição')}</div>
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
                  <ArrowDownToLine size={14} />
                  {' ' + t('Exportar relatório')}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
      <div className="runner-footnote">
        <Info size={14} />
        {' ' +
          t('O ambiente é capturado no início. Tokens extraídos só existem durante esta execução.')}
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
        eyebrow={t('CADA REQUEST CONTA UMA HISTÓRIA')}
        title={t('Seu caminho até aqui.')}
        description={t('Revisite as requisições que você enviou, sem perder o fio da meada.')}
        action={
          <Button variant="outline" disabled={!history.length} onClick={() => setConfirm(true)}>
            <Trash2 size={14} />
            {' ' + t('Limpar histórico')}
          </Button>
        }
      />
      <div className="stat-cards">
        <div className="stat-card">
          <span className="stat-icon purple">
            <History size={20} />
          </span>
          <div>
            <span>{t('Requisições enviadas')}</span>
            <strong>{formatNumber(history.length)}</strong>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon green">
            <CheckCheck size={20} />
          </span>
          <div>
            <span>{t('Respostas de sucesso')}</span>
            <strong>
              {formatNumber(history.filter((r) => r.status !== null && r.status < 400).length)}
            </strong>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon amber">
            <Clock3 size={20} />
          </span>
          <div>
            <span>{t('Tempo médio')}</span>
            <strong>
              {formatNumber(average)}
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
              aria-label={t('Buscar no histórico')}
              placeholder={t('Buscar requisições…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="segmented-control">
            {[
              { id: 'all', label: t('Todas') },
              { id: 'success', label: t('Sucesso') },
              { id: 'error', label: t('Erros') },
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
          <span className="muted">
            {formatNumber(rows.length)}
            {' ' + t('resultados')}
          </span>
        </div>
        {rows.length ? (
          <div className="history-table">
            <div className="history-row history-table-heading">
              <span>{t('REQUISIÇÃO')}</span>
              <span>STATUS</span>
              <span>{t('TEMPO')}</span>
              <span>{t('QUANDO')}</span>
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
                  {row.status || t('Erro de rede')}
                </span>
                <span className="mono">{formatNumber(row.duration)} ms</span>
                <span>
                  {formatDate(row.date, {
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
                ? t('Nenhum resultado encontrado')
                : t('Toda jornada tem um primeiro request.')}
            </h3>
            <p>
              {search || filter !== 'all'
                ? t('Experimente outros termos ou altere o filtro.')
                : t('As requisições enviadas pelo editor vão aparecer aqui.')}
            </p>
            <span className="privacy-note">
              <LockKeyhole size={12} />
              {' ' + t('Apenas metadados. Corpos e credenciais não entram no histórico.')}
            </span>
          </div>
        )}
      </section>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('Limpar o histórico?')}
        description={t(
          'Os metadados das requisições serão removidos. Suas coleções não serão afetadas.',
        )}
      >
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setConfirm(false)}>
            {t('Cancelar')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onClear();
              setConfirm(false);
              toast.success(t('Histórico limpo'));
            }}
          >
            {t('Limpar histórico')}
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
  updates,
}: {
  workspace: Workspace;
  onChange: (workspace: Workspace) => void;
  onImport: () => void;
  onHelp: () => void;
  updates: React.ReactNode;
}) {
  const settings = workspace.settings;
  const locale = useLocale();
  const update = (patch: Partial<Workspace['settings']>) =>
    onChange({ ...workspace, settings: { ...settings, ...patch } });
  const size = useMemo(
    () => new TextEncoder().encode(JSON.stringify(workspace)).length,
    [workspace],
  );
  return (
    <div className="workspace-page settings-page">
      <PageHeading
        eyebrow={t('DO SEU JEITO')}
        title={t('Um workspace com a sua cara.')}
        description={t('Ajuste os detalhes e deixe o Fedexe trabalhar no seu ritmo.')}
      />
      <section className="surface settings-surface">
        <label className="field-label workspace-name-field">
          {t('Idioma da interface')}
          <select
            className="input"
            value={locale}
            onChange={(event) => {
              try {
                setLocale(event.target.value as Locale);
              } catch {
                toast.error(t('Não foi possível salvar a preferência de idioma.'));
              }
            }}
          >
            <option value="en-US" lang="en-US">
              English (US)
            </option>
            <option value="pt-BR" lang="pt-BR">
              Português (Brasil)
            </option>
          </select>
        </label>
      </section>
      {updates}
      <section className="surface settings-surface">
        <div className="settings-section-heading">
          <Monitor size={20} />
          <div>
            <h3>{t('Aparência')}</h3>
            <p>{t('Conforto visual para cada momento do dia.')}</p>
          </div>
        </div>
        <div className="theme-options">
          {(
            [
              { value: 'light', label: t('Claro'), icon: Sun },
              { value: 'dark', label: t('Escuro'), icon: Moon },
              { value: 'system', label: t('Sistema'), icon: Monitor },
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
          title={t('Interface compacta')}
          description={t('Reduza os espaçamentos na árvore de coleções.')}
          checked={settings.compact}
          onChange={(compact) => update({ compact })}
        />
        <SettingToggle
          title={t('Quebra de linha nas respostas')}
          description={t('Leia respostas longas sem rolar horizontalmente.')}
          checked={settings.wrap}
          onChange={(wrap) => update({ wrap })}
        />
      </section>
      <section className="surface settings-surface">
        <div className="settings-section-heading">
          <HardDrive size={20} />
          <div>
            <h3>{t('Seu espaço, seus dados')}</h3>
            <p>{t('Sem nuvem obrigatória. Sem contas. Sem surpresas.')}</p>
          </div>
        </div>
        <label className="field-label workspace-name-field">
          {t('Nome do workspace')}
          <input
            className="input"
            maxLength={60}
            value={settings.workspaceName}
            onChange={(e) => update({ workspaceName: e.target.value })}
          />
        </label>
        <div className="data-information">
          <span>
            <Database size={16} />
            {' ' + t('Armazenamento local')}
          </span>
          <strong>
            {formatNumber(size / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB
          </strong>
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
            <ArrowDownToLine size={15} />
            {' ' + t('Exportar backup')}
          </Button>
          <Button variant="outline" onClick={onImport}>
            <FileJson2 size={15} />
            {' ' + t('Importar dados')}
          </Button>
        </div>
        <p className="field-hint">
          {native
            ? t(
                'O workspace é salvo em JSON. Segredos marcados ficam no Gerenciador de Credenciais do Windows.',
              )
            : t('O navegador salva o workspace localmente e mantém os segredos apenas na sessão.')}
        </p>
      </section>
      <section className="about-card">
        <span className="brand-mark">
          f<span>↗</span>
        </span>
        <div>
          <h3>{t('Feito para quem constrói.')}</h3>
          <p>{t('Fedexe API · Interface 0.2 · MIT · Local-first')}</p>
        </div>
        <Button variant="outline" onClick={onHelp}>
          {t('Conhecer o projeto') + ' '}
          <ArrowUpRight size={14} />
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
