import {
  formatDate,
  formatNumber,
  setLocale,
  t,
  useLocale,
  type Locale,
  type Message,
} from '../lib/i18n';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
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
  Globe2,
  HardDrive,
  History,
  Info,
  Layers3,
  LockKeyhole,
  Monitor,
  Palette,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  pair,
  DEFAULT_TIMEOUT_MS,
  redactSecrets,
  requestsForRun,
  safeEnvironment,
  exportableWorkspace,
  type Environment,
  type HistoryItem,
  type RequestItem,
  type RedirectPolicy,
  type RunResult,
  type RunFailureReason,
  type RunRow,
  type RunScope,
  type Workspace,
} from '../lib/models';
import { prepareCollection } from '../lib/collection-runner';
import { cn, download, uid } from '../lib/utils';
import { hasScripts } from '../lib/scripts';
import { native, normalizeError, runCollection } from '../lib/transport';
import { PairEditor } from './PairEditor';
import { LoadRunner } from './LoadRunner';
import { MethodBadge } from './RequestEditor';
import { TimeoutInput } from './TimeoutInput';
import { ThemeSettingsPanel } from './ThemeSettings';
import { LocalAiSettings } from './LocalAiSettings';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Dropdown } from './ui/dropdown';

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
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
                          JSON.stringify(
                            safeEnvironment(environment, workspace.collections),
                            null,
                            2,
                          ),
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
              {' ' + t('Alterações salvas automaticamente')}
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

const runFailureLabels = {
  status: 'Status HTTP inesperado',
  header: 'Validação de cabeçalhos',
  json: 'Validação do corpo JSON',
  extraction: 'Extração de variáveis',
  preparation: 'Preparação da requisição',
  transport: 'Falha de comunicação HTTP',
  script: 'Falha de script',
  other: 'Outras falhas',
} satisfies Record<RunFailureReason | 'other', Message>;

function RunFailureGroups({
  rows,
  onOpenRequest,
}: {
  rows: RunRow[];
  onOpenRequest: (index: number, source: HTMLButtonElement) => void;
}) {
  const groups = Object.entries(runFailureLabels).flatMap(([reason, label]) => {
    const affected = rows.flatMap((row, index) => {
      const failures = row.failures.filter(
        (_, failureIndex) => (row.failure_reasons?.[failureIndex] ?? 'other') === reason,
      );
      return failures.length ? [{ index, name: row.name, failures }] : [];
    });
    return affected.length ? [{ reason, label, affected }] : [];
  });

  return (
    <section className="runner-failure-groups">
      <h4>{t('Falhas por motivo')}</h4>
      {groups.length ? (
        groups.map(({ reason, label, affected }) => (
          <details key={reason} className="runner-failure-group">
            <summary>
              <ChevronRight size={14} aria-hidden="true" />
              <span>{t(label)}</span>
              <small>
                {t(
                  affected.length === 1 ? '{0} requisição afetada' : '{0} requisições afetadas',
                  affected.length,
                )}
              </small>
            </summary>
            <ol>
              {affected.map(({ index, name, failures }) => (
                <li key={index}>
                  <button
                    type="button"
                    className="runner-failure-request"
                    onClick={(event) => onOpenRequest(index, event.currentTarget)}
                  >
                    <span>
                      {formatNumber(index + 1)} · {name}
                    </span>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                  <ul>
                    {failures.map((failure, failureIndex) => (
                      <li key={failureIndex}>{failure}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </details>
        ))
      ) : (
        <p className="runner-report-caption">{t('Nenhuma falha registrada.')}</p>
      )}
    </section>
  );
}

export type RunnerFolder = { collectionId: string; folder: string; environmentId: string };

export function RunnerView({
  workspace,
  initialFolder,
  busy,
  setBusy,
  onCancel,
  onResults,
}: {
  workspace: Workspace;
  initialFolder?: RunnerFolder;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onCancel: () => void;
  onResults: (result: RunResult) => void;
}) {
  const [loadMode, setLoadMode] = useState(false);
  const requestDefaults = {
    defaultTimeoutMs: workspace.settings.defaultTimeoutMs,
    defaultRedirectPolicy: native ? workspace.settings.defaultRedirectPolicy : undefined,
  };
  const [showLoadResults, setShowLoadResults] = useState(false);
  const [showFunctionalResults, setShowFunctionalResults] = useState(false);
  const analysing = loadMode ? showLoadResults : showFunctionalResults;
  const configurationHeading = useRef<HTMLHeadingElement>(null);
  const functionalHeading = useRef<HTMLHeadingElement>(null);
  const focusFunctionalScreen = useRef(false);
  const [collectionId, setCollectionId] = useState(workspace.collections[0]?.id || '');
  const collection =
    workspace.collections.find((c) => c.id === collectionId) ?? workspace.collections[0];
  const [environmentId, setEnvironmentId] = useState('');
  const [scope, setScope] = useState<RunScope>('collection');
  const [folder, setFolder] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [folderExclusions, setFolderExclusions] = useState<Set<string>>(() => new Set());
  const [runPlan, setRunPlan] = useState<{
    requests: RequestItem[];
    context: string;
    iterations: number;
    requestsPerIteration: number;
  }>();
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [expandedRows, setExpandedRows] = useState<number[]>([]);
  const [runnerTab, setRunnerTab] = useState<'results' | 'report'>('results');
  const [targetIndex, setTargetIndex] = useState<number>();
  const targetRow = useRef<HTMLTableRowElement>(null);
  const [reportOrigin, setReportOrigin] = useState<HTMLButtonElement>();
  const [inspectedRankIndex, setInspectedRankIndex] = useState<number>();
  const reportReturnTarget = useRef<HTMLButtonElement>(null);
  const reportTabButton = useRef<HTMLButtonElement>(null);
  const [activeStep, setActiveStep] = useState<number>();
  const [rows, setRows] = useState<RunRow[]>([]);
  const [result, setResult] = useState<RunResult>();
  const [running, setRunning] = useState(false);
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [iterationsInput, setIterationsInput] = useState('1');
  const [delayInput, setDelayInput] = useState('0');
  const [cancelling, setCancelling] = useState(false);
  const environment = workspace.environments.find((env) => env.id === environmentId);
  const scopedRequests = requestsForRun(collection, scope, folder, selection);
  const chosen =
    scope === 'folder'
      ? scopedRequests.filter(({ id }) => !folderExclusions.has(id))
      : scopedRequests;
  const iterations = Number(iterationsInput);
  const delay = Number(delayInput);
  const validOptions =
    Number.isInteger(iterations) &&
    iterations >= 1 &&
    iterations <= 100 &&
    delayInput !== '' &&
    Number.isInteger(delay) &&
    delay >= 0 &&
    delay <= 60000;
  const plannedSteps = chosen.length * (validOptions ? iterations : 1);
  const chosenIds = new Set(chosen.map(({ id }) => id));
  const choosingRequests = scope === 'selection' || scope === 'folder';
  const previewRequests = scope === 'selection' ? (collection?.requests ?? []) : scopedRequests;
  const requests = runPlan?.requests ?? [];
  const activeRequest = activeStep === undefined ? undefined : runPlan?.requests[activeStep];
  const totalSteps = runPlan?.requests.length ?? 0;
  const currentStep = activeStep ?? Math.min(rows.length, totalSteps - 1);
  const failed = rows.filter((r) => r.failures.length).length;
  const passed = rows.filter((row) => !row.skipped && !row.failures.length).length;
  const completedLabel = t(
    '{0} de {1} {2}',
    rows.length,
    totalSteps,
    totalSteps === 1 ? t('etapa concluída') : t('etapas concluídas'),
  );
  const approvedLabel = passed === 1 ? t('aprovada') : t('aprovadas');
  const chosenLabel = t('{0} {1}', chosen.length, chosen.length === 1 ? t('etapa') : t('etapas'));
  const outcomeLabel = {
    completed: t('Execução concluída'),
    cancelled: t('Execução cancelada'),
    stopped_on_failure: t('Execução interrompida na primeira falha'),
  };
  const duration =
    result?.duration_ms ?? rows.reduce((sum, row) => sum + row.http_ms + row.validation_ms, 0);
  const rankedRows = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, index, total: row.http_ms + row.validation_ms }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
    [rows],
  );
  const rankScale = Math.max(rankedRows[0]?.total ?? 0, 1);
  const inspectedRow = inspectedRankIndex === undefined ? undefined : rows[inspectedRankIndex];
  const displayedRanks =
    inspectedRankIndex !== undefined &&
    inspectedRow &&
    !rankedRows.some(({ index }) => index === inspectedRankIndex)
      ? [
          ...rankedRows,
          {
            index: inspectedRankIndex,
            row: inspectedRow,
            total: inspectedRow.http_ms + inspectedRow.validation_ms,
          },
        ]
      : rankedRows;
  useEffect(() => {
    if (runnerTab !== 'results' || targetIndex === undefined) return;
    targetRow.current?.focus({ preventScroll: true });
    targetRow.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
    setTargetIndex(undefined);
  }, [runnerTab, targetIndex]);
  useEffect(() => {
    if (runnerTab !== 'report') return;
    const target = reportReturnTarget.current;
    if (target?.isConnected) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    } else if (target) {
      reportTabButton.current?.focus();
    }
    reportReturnTarget.current = null;
    setReportOrigin(undefined);
  }, [runnerTab]);
  const context = [
    collection?.name,
    scope === 'folder'
      ? folder
      : t(scope === 'selection' ? 'Requisições selecionadas' : 'Coleção inteira'),
    environment?.name,
  ]
    .filter(Boolean)
    .join(' · ');
  const notRunLabel =
    result?.outcome === 'cancelled'
      ? t('Não executada por cancelamento')
      : result?.outcome === 'stopped_on_failure'
        ? t('Não executada após falha')
        : t('Não executada');
  function showResult(index: number, source: HTMLButtonElement, openDetails = false) {
    if (openDetails) {
      setExpandedRows((current) => (current.includes(index) ? current : [...current, index]));
    } else {
      setFailuresOnly(false);
    }
    setReportOrigin(source);
    setRunnerTab('results');
    setTargetIndex(index);
  }

  const clearRun = useCallback(() => {
    setRows([]);
    setRunPlan(undefined);
    setFailuresOnly(false);
    setExpandedRows([]);
    setRunnerTab('results');
    setTargetIndex(undefined);
    setReportOrigin(undefined);
    reportReturnTarget.current = null;
    setInspectedRankIndex(undefined);
    setActiveStep(undefined);
    setResult(undefined);
    setCancelling(false);
  }, []);
  useEffect(() => {
    if (focusFunctionalScreen.current) {
      (showFunctionalResults ? functionalHeading : configurationHeading).current?.focus();
      focusFunctionalScreen.current = false;
    }
  }, [showFunctionalResults]);
  function navigateFunctional(show: boolean) {
    focusFunctionalScreen.current = true;
    setShowFunctionalResults(show);
  }
  useEffect(() => {
    if (!initialFolder) return;
    setLoadMode(false);
    setShowLoadResults(false);
    setShowFunctionalResults(false);
    setCollectionId(initialFolder.collectionId);
    setScope('folder');
    setFolder(initialFolder.folder);
    setFolderExclusions(new Set());
    setEnvironmentId(initialFolder.environmentId);
    setSelection([]);
    clearRun();
  }, [initialFolder, clearRun]);
  async function run() {
    if (!collection || !chosen.length || !environment || busy || !validOptions) return;
    setBusy(true);
    setRunning(true);
    clearRun();
    navigateFunctional(true);
    setRunPlan({
      requests: Array.from({ length: plannedSteps }, (_, index) => chosen[index % chosen.length]),
      context,
      iterations,
      requestsPerIteration: chosen.length,
    });
    try {
      const snapshot = structuredClone({
        collection,
        environment,
        requests: chosen,
        defaults: requestDefaults,
      });
      const nativeCollection = prepareCollection(
        snapshot.collection,
        snapshot.environment,
        snapshot.requests,
        stopOnFailure,
        native,
        snapshot.defaults,
      );
      const redactRows = (rows: RunRow[]) =>
        rows.map((row) => ({
          ...row,
          failures: row.failures.map((message) => redactSecrets(message, snapshot.environment)),
        }));
      const outcome = await runCollection(
        { ...nativeCollection, iterations, delay_ms: delay },
        (event) => {
          if (event.type === 'started') {
            setActiveStep(event.index);
          } else {
            const [row] = redactRows([event.row]);
            setRows((current) => [...current, row]);
            setActiveStep((current) => (current === event.index ? undefined : current));
          }
        },
        snapshot.requests.map((request) => request.id),
        hasScripts(snapshot.collection.scripts) ||
          snapshot.requests.some((request) => hasScripts(request.scripts))
          ? snapshot
          : undefined,
      );
      const result = { ...outcome, results: redactRows(outcome.results) };
      setRows(result.results);
      setResult(result);
      onResults(result);
      if (result.outcome === 'completed')
        toast[result.results.some((r) => r.failures.length) ? 'warning' : 'success'](
          t('Execução concluída'),
        );
    } catch (error) {
      toast.error(redactSecrets(normalizeError(error).message, environment));
    } finally {
      setCancelling(false);
      setActiveStep(undefined);
      setRunning(false);
      setBusy(false);
    }
  }
  const requestPreview = (
    <section className={cn('runner-request-picker', !loadMode && 'surface')}>
      <div className="surface-heading">
        <div>
          <h3>{t(choosingRequests ? 'Selecione as requisições' : 'Requisições no escopo')}</h3>
          <p>
            {choosingRequests
              ? t('{0} de {1} requisições selecionadas', chosen.length, previewRequests.length)
              : chosenLabel}
          </p>
        </div>
        {choosingRequests && previewRequests.length > 0 && (
          <div className="load-actions">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || chosen.length === previewRequests.length}
              onClick={() =>
                scope === 'folder'
                  ? setFolderExclusions(new Set())
                  : setSelection(previewRequests.map(({ id }) => id))
              }
            >
              {t('Marcar todas')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || chosen.length === 0}
              onClick={() =>
                scope === 'folder'
                  ? setFolderExclusions(new Set(previewRequests.map(({ id }) => id)))
                  : setSelection([])
              }
            >
              {t('Desmarcar todas')}
            </Button>
          </div>
        )}
      </div>
      {previewRequests.length > 0 ? (
        <div className="runner-table-scroll">
          <table className="runner-table">
            <thead>
              <tr>
                {choosingRequests && <th scope="col" aria-label={t('Seleção')} />}
                <th scope="col">{t('Método')}</th>
                <th scope="col">{t('Requisição')}</th>
              </tr>
            </thead>
            <tbody>
              {previewRequests.map((request) => (
                <tr key={request.id}>
                  {choosingRequests && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t('Executar {0}', request.name)}
                        disabled={busy}
                        checked={chosenIds.has(request.id)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          if (scope === 'folder') {
                            setFolderExclusions((current) => {
                              const next = new Set(current);
                              if (checked) next.delete(request.id);
                              else next.add(request.id);
                              return next;
                            });
                            return;
                          }
                          setSelection((current) =>
                            checked
                              ? [...current, request.id]
                              : current.filter((id) => id !== request.id),
                          );
                        }}
                      />
                    </td>
                  )}
                  <td>
                    <MethodBadge method={request.method} small />
                  </td>
                  <th scope="row" className="runner-request-name">
                    {request.name}
                  </th>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="runner-empty">{t('Nenhuma requisição no escopo')}</p>
      )}
    </section>
  );
  return (
    <div className="workspace-page runner-page">
      {!analysing && (
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
      )}
      <div className={cn('runner-layout', analysing && 'runner-analysis-layout')}>
        <section className="surface runner-configuration" hidden={analysing}>
          <div className="surface-heading">
            <h3 ref={configurationHeading} tabIndex={-1}>
              {t('Configurar execução')}
            </h3>
          </div>
          <div className="runner-fields">
            <label className="field-label">
              {t('Tipo de execução')}
              <select
                className="input"
                disabled={busy}
                value={loadMode ? 'load' : 'functional'}
                onChange={(event) => {
                  const next = event.target.value === 'load';
                  if (next && scope === 'selection') {
                    setScope('collection');
                  }
                  setLoadMode(next);
                  setShowLoadResults(false);
                }}
              >
                <option value="functional">{t('Teste funcional')}</option>
                <option value="load">{t('Teste de carga')}</option>
              </select>
            </label>
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
                  setFolderExclusions(new Set());
                  setSelection([]);
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
                }}
              >
                <option value="collection">{t('Coleção inteira')}</option>
                <option value="folder">{t('Pasta')}</option>
                {!loadMode && <option value="selection">{t('Requisições selecionadas')}</option>}
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
                    setFolderExclusions(new Set());
                  }}
                >
                  <option value="">{t('Selecione uma pasta')}</option>
                  {collection?.folders.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            )}
            {!loadMode && (
              <>
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
                <div className="runner-timing-fields">
                  <label className="field-label">
                    {t('Iterações')}
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      required
                      disabled={busy}
                      value={iterationsInput}
                      onChange={(event) => setIterationsInput(event.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    {t('Intervalo entre requisições (ms)')}
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={60000}
                      step={1}
                      required
                      disabled={busy}
                      value={delayInput}
                      onChange={(event) => setDelayInput(event.target.value)}
                    />
                  </label>
                </div>
                {!validOptions && (
                  <p className="field-hint" role="status">
                    {t('Use de 1 a 100 iterações e um intervalo de 0 a 60000 ms.')}
                  </p>
                )}
              </>
            )}
            <p className="field-hint">
              {t(
                'O runner usa as requisições salvas. Salve suas alterações no editor antes de executar.',
              )}
            </p>
          </div>
          {!loadMode && (
            <div className="runner-start">
              <Button
                onClick={run}
                disabled={busy || !chosen.length || !environment || !validOptions}
              >
                <Play size={15} fill="currentColor" />
                {' ' + t('Executar') + ' '}
                {formatNumber(plannedSteps)}{' '}
                {plannedSteps === 1 ? t('requisição') : t('requisições')}
              </Button>
              {runPlan && (
                <Button variant="secondary" onClick={() => navigateFunctional(true)}>
                  {t('Ver resultados')}
                </Button>
              )}
              <span>
                <LockKeyhole size={11} />
                {' ' + t('Variáveis isoladas por rodada')}
              </span>
            </div>
          )}
        </section>
        {loadMode && (
          <section className="surface load-panel">
            <LoadRunner
              requestPicker={scope === 'folder' && folder ? requestPreview : undefined}
              exportRequestIds={
                scope === 'folder' && chosen.length !== scopedRequests.length
                  ? chosen.map(({ id }) => id)
                  : undefined
              }
              showResults={showLoadResults}
              onShowResults={setShowLoadResults}
              context={context}
              collection={collection}
              environment={environment}
              requests={chosen}
              defaults={requestDefaults}
              busy={busy}
              setBusy={setBusy}
              onCancel={onCancel}
            />
          </section>
        )}
        {!loadMode && !showFunctionalResults && requestPreview}
        <section className="surface runner-results" hidden={loadMode || !showFunctionalResults}>
          <div className="runner-results-header">
            <div className="surface-heading">
              <div>
                <h3 ref={functionalHeading} tabIndex={-1}>
                  {running
                    ? t('Execução em andamento')
                    : result
                      ? outcomeLabel[result.outcome]
                      : t('Resultados da execução')}
                </h3>
                <p>{runPlan?.context ?? context}</p>
                <p role="status" aria-atomic="true">
                  {runPlan ? completedLabel : chosenLabel}
                  {running &&
                    runPlan &&
                    runPlan.iterations > 1 &&
                    ` · ${t('Iteração {0} de {1}', Math.floor(currentStep / runPlan.requestsPerIteration) + 1, runPlan.iterations)}`}
                  {running && activeRequest && ` · ${activeRequest.name}`}
                </p>
              </div>
              <div className="load-actions">
                {running && (
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
                )}
                <Button variant="secondary" onClick={() => navigateFunctional(false)}>
                  <ArrowLeft size={15} /> {t('Voltar à configuração')}
                </Button>
              </div>
            </div>
            {(running || rows.length > 0 || result) && (
              <div className="run-summary">
                <span>
                  <CircleCheck size={15} className="green-text" />
                  <strong>{formatNumber(passed)}</strong> {approvedLabel}
                </span>
                <span>
                  <Clock3 size={15} />
                  <strong>{formatNumber(duration)}</strong> ms
                </span>
                {runnerTab === 'report' ? (
                  <>
                    <span>
                      <strong>{formatNumber(failed)}</strong> {t('com falha')}
                    </span>
                    {result && (
                      <span>
                        <strong>{formatNumber(totalSteps - rows.length)}</strong>{' '}
                        {t('não executadas')}
                      </span>
                    )}
                  </>
                ) : (
                  <div
                    className="segmented-control runner-filters"
                    role="group"
                    aria-label={t('Filtrar resultados')}
                  >
                    <button
                      type="button"
                      aria-pressed={!failuresOnly}
                      className={cn(!failuresOnly && 'active')}
                      onClick={() => setFailuresOnly(false)}
                    >
                      {t('Todas')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={failuresOnly}
                      className={cn(failuresOnly && 'active')}
                      onClick={() => setFailuresOnly(true)}
                    >
                      {t('Falhas ({0})', formatNumber(failed))}
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="runner-view-bar">
              <div
                className="runner-tabs"
                role="tablist"
                aria-label={t('Visualização da execução')}
              >
                {(['results', 'report'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    ref={tab === 'report' ? reportTabButton : undefined}
                    id={`runner-tab-${tab}`}
                    aria-controls={`runner-panel-${tab}`}
                    aria-selected={runnerTab === tab}
                    tabIndex={runnerTab === tab ? 0 : -1}
                    onClick={() => setRunnerTab(tab)}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                      event.preventDefault();
                      const next =
                        event.key === 'Home'
                          ? 'results'
                          : event.key === 'End'
                            ? 'report'
                            : tab === 'results'
                              ? 'report'
                              : 'results';
                      setRunnerTab(next);
                      event.currentTarget.parentElement
                        ?.querySelector<HTMLButtonElement>(`#runner-tab-${next}`)
                        ?.focus();
                    }}
                  >
                    {tab === 'results' ? t('Resultados') : t('Relatório')}
                  </button>
                ))}
              </div>
              {runnerTab === 'results' && reportOrigin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    reportReturnTarget.current = reportOrigin;
                    setRunnerTab('report');
                  }}
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                  {t('Voltar ao relatório')}
                </Button>
              )}
              {runnerTab === 'report' && result && (
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
            {running && (
              <div
                className="run-progress"
                role="progressbar"
                aria-label={t('Etapas concluídas')}
                aria-valuenow={rows.length}
                aria-valuemax={totalSteps || 1}
              >
                <div style={{ width: `${(rows.length / (totalSteps || 1)) * 100}%` }} />
              </div>
            )}
          </div>
          <div
            id="runner-panel-results"
            role="tabpanel"
            aria-labelledby="runner-tab-results"
            hidden={runnerTab !== 'results'}
          >
            {requests.length > 0 && (!failuresOnly || failed > 0) && (
              <div
                className="runner-table-scroll"
                tabIndex={0}
                role="region"
                aria-label={t('Resultados da execução')}
              >
                <table className="runner-table" aria-label={t('Resultados da execução')}>
                  <thead>
                    <tr>
                      <th scope="col" aria-label={t('Etapa')}>
                        #
                      </th>
                      <th scope="col">{t('Método')}</th>
                      <th scope="col">{t('Requisição')}</th>
                      <th scope="col">{t('Validação')}</th>
                      <th scope="col">{t('Status HTTP')}</th>
                      <th scope="col">{t('Duração')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((request, index) => {
                      const row = rows[index];
                      const hasFailures = Boolean(row?.failures.length);
                      const hasDetails = hasFailures || Boolean(row?.scriptResults?.length);
                      if (failuresOnly && !hasFailures) return null;
                      const active = running && index === activeStep;
                      const expanded = expandedRows.includes(index);
                      const detailsId = `runner-failures-${index}`;
                      return (
                        <Fragment key={runPlan ? index : request.id}>
                          <tr
                            className={cn('runner-request-row', active && 'active')}
                            aria-current={active ? 'step' : undefined}
                            ref={targetIndex === index ? targetRow : undefined}
                            tabIndex={-1}
                          >
                            <td>{formatNumber(index + 1)}</td>
                            <td>
                              <MethodBadge method={request.method} small />
                            </td>
                            <th scope="row" className="runner-request-name">
                              {hasDetails ? (
                                <button
                                  className="runner-disclosure"
                                  type="button"
                                  aria-expanded={expanded}
                                  aria-controls={detailsId}
                                  aria-label={t(
                                    hasFailures
                                      ? 'Detalhes da falha em {0}'
                                      : 'Detalhes dos testes em {0}',
                                    request.name,
                                  )}
                                  onClick={() =>
                                    setExpandedRows((current) =>
                                      current.includes(index)
                                        ? current.filter((item) => item !== index)
                                        : [...current, index],
                                    )
                                  }
                                >
                                  <ChevronRight size={14} aria-hidden="true" />
                                  <span>{request.name}</span>
                                </button>
                              ) : (
                                <strong>{request.name}</strong>
                              )}
                              <code>{request.url.replace('{{base_url}}', '')}</code>
                              {runPlan && runPlan.iterations > 1 && (
                                <code>
                                  {t(
                                    'Iteração {0} de {1}',
                                    Math.floor(index / runPlan.requestsPerIteration) + 1,
                                    runPlan.iterations,
                                  )}
                                </code>
                              )}
                            </th>
                            <td>
                              {row?.skipped && !hasFailures ? (
                                <span
                                  className="muted"
                                  title={t('Requisição ignorada pelo script.')}
                                >
                                  {t('Ignorada')}
                                </span>
                              ) : row ? (
                                <span
                                  className={cn(
                                    'runner-validation',
                                    hasFailures ? 'red-text' : 'green-text',
                                  )}
                                >
                                  {hasFailures ? (
                                    <X size={14} aria-hidden="true" />
                                  ) : (
                                    <Check size={14} aria-hidden="true" />
                                  )}
                                  {hasFailures ? t('Falhou') : t('Aprovada')}
                                </span>
                              ) : (
                                <span className={cn(active && 'purple-text')}>
                                  {active
                                    ? t('Em execução')
                                    : running
                                      ? t('Pendente')
                                      : runPlan
                                        ? notRunLabel
                                        : t('{0} testes', request.tests.length)}
                                </span>
                              )}
                            </td>
                            <td className="runner-number">{row?.status ?? '—'}</td>
                            <td className="runner-number">
                              {row ? `${formatNumber(row.http_ms + row.validation_ms)} ms` : '—'}
                            </td>
                          </tr>
                          {hasDetails && (
                            <tr id={detailsId} hidden={!expanded} className="runner-failure-row">
                              <td colSpan={6}>
                                <ul>
                                  {row?.failures.map((failure, i) => (
                                    <li key={i}>{failure}</li>
                                  ))}
                                  {row?.scriptResults
                                    ?.filter((test) => test.passed)
                                    .map((test, i) => (
                                      <li key={`script-${i}`}>
                                        {t('Aprovada')} · {test.label}
                                      </li>
                                    ))}
                                </ul>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {failuresOnly && !failed && (
              <p className="runner-empty">{t('Nenhuma falha registrada.')}</p>
            )}
            {!requests.length && (
              <div className="center-empty">
                <Layers3 size={30} />
                <h3>
                  {collection?.requests.length
                    ? t('Nenhuma requisição no escopo')
                    : t('Nenhuma requisição por aqui')}
                </h3>
                <p>
                  {collection?.requests.length
                    ? t('Selecione uma pasta com requisições para executar.')
                    : t('Adicione endpoints à sua coleção para começar.')}
                </p>
              </div>
            )}
          </div>
          <div
            id="runner-panel-report"
            role="tabpanel"
            aria-labelledby="runner-tab-report"
            hidden={runnerTab !== 'report'}
            className="runner-report"
          >
            <RunFailureGroups
              rows={rows}
              onOpenRequest={(index, source) => showResult(index, source, true)}
            />
            <h4>{t('Requisições mais lentas')}</h4>
            {rankedRows.length ? (
              <>
                <p className="runner-report-caption">
                  {t('{0} de {1} requisições por duração total', rankedRows.length, rows.length)}
                </p>
                <ol className="runner-ranking">
                  {displayedRanks.map(({ row, index, total }, position) => (
                    <li key={index}>
                      <button
                        type="button"
                        className="runner-ranking-item"
                        onClick={(event) => {
                          setInspectedRankIndex(index);
                          showResult(index, event.currentTarget);
                        }}
                      >
                        <span className="runner-ranking-heading">
                          <span>{row.name}</span>
                          <strong>{formatNumber(total)} ms</strong>
                        </span>
                        <span className="runner-ranking-track" aria-hidden="true">
                          <span
                            className="runner-ranking-http"
                            style={{ width: `${(row.http_ms / rankScale) * 100}%` }}
                          />
                          <span
                            className="runner-ranking-validation"
                            style={{ width: `${(row.validation_ms / rankScale) * 100}%` }}
                          />
                        </span>
                        <span className="runner-ranking-breakdown">
                          <span>{t('HTTP {0} ms', row.http_ms)}</span>
                          <span>{t('Validação {0} ms', row.validation_ms)}</span>
                        </span>
                        {position >= rankedRows.length && (
                          <span className="runner-report-caption">{t('Fora do top 10')}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="runner-report-caption">
                {t('Os tempos aparecem aqui quando uma requisição é concluída.')}
              </p>
            )}
          </div>
        </section>
      </div>
      {!analysing && (
        <div className="runner-footnote">
          <Info size={14} />
          {' ' +
            t(
              'O ambiente é capturado no início. Tokens extraídos só existem durante esta execução.',
            )}
        </div>
      )}
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

const settingsSections = [
  { label: 'Aparência', icon: Monitor },
  { label: 'Temas', icon: Palette },
  { label: 'Padrões de requisição', icon: Clock3 },
  { label: 'IA', icon: Sparkles },
  { label: 'Dados e backups', icon: HardDrive },
  { label: 'Atualizações e sobre', icon: Info },
] as const;

export function SettingsView({
  workspace,
  onChange,
  onImport,
  onBackup,
  onDrive,
  updates,
  version,
}: {
  workspace: Workspace;
  onChange: (workspace: Workspace) => void;
  onImport: () => void;
  onBackup: () => void;
  onDrive?: () => void;
  updates: React.ReactNode;
  version: string;
}) {
  const settings = workspace.settings;
  const [section, setSection] = useState<(typeof settingsSections)[number]['label']>('Aparência');
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
        title={t('Configurações')}
        description={t('Gerencie as preferências do Fedexe API e do workspace.')}
      />
      <div className="settings-layout">
        <nav className="settings-menu" aria-label={t('Configurações')}>
          {settingsSections.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              aria-current={section === label ? 'true' : undefined}
              onClick={() => setSection(label)}
            >
              <Icon size={17} aria-hidden="true" />
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {section === 'Aparência' && (
            <section className="surface settings-surface">
              <div className="settings-section-heading">
                <h2>{t('Aparência')}</h2>
              </div>
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
          )}
          {section === 'Temas' && <ThemeSettingsPanel settings={settings} onChange={update} />}
          {section === 'IA' && <LocalAiSettings />}
          {section === 'Padrões de requisição' && (
            <section className="surface settings-surface">
              <div className="settings-section-heading">
                <h2>{t('Padrões de requisição')}</h2>
              </div>
              <div className="settings-default-field">
                <TimeoutInput
                  label={t('Timeout padrão do workspace (ms)')}
                  value={settings.defaultTimeoutMs}
                  placeholder={String(DEFAULT_TIMEOUT_MS)}
                  onChange={(defaultTimeoutMs) => update({ defaultTimeoutMs })}
                />
                <p className="field-hint">
                  {t(
                    'Usado em requisições sem um timeout próprio. Deixe em branco para usar 30 segundos.',
                  )}
                </p>
                {settings.defaultTimeoutMs !== undefined &&
                  settings.defaultTimeoutMs !== DEFAULT_TIMEOUT_MS && (
                    <Button
                      variant="outline"
                      onClick={() => update({ defaultTimeoutMs: undefined })}
                    >
                      {t('Restaurar padrão de 30 segundos')}
                    </Button>
                  )}
              </div>
              {native && (
                <div className="settings-default-field">
                  <label className="field-label">
                    {t('Redirecionamento padrão do workspace')}
                    <select
                      className="input"
                      value={settings.defaultRedirectPolicy ?? 'none'}
                      aria-describedby="workspace-redirect-hint"
                      onChange={(event) =>
                        update({ defaultRedirectPolicy: event.target.value as RedirectPolicy })
                      }
                    >
                      <option value="none">{t('Não seguir')}</option>
                      <option value="same_origin">{t('Seguir apenas na mesma origem')}</option>
                    </select>
                  </label>
                  <p className="field-hint" id="workspace-redirect-hint">
                    {t(
                      'Cada requisição pode usar o padrão do workspace ou definir sua própria regra.',
                    )}
                  </p>
                </div>
              )}
            </section>
          )}
          {section === 'Dados e backups' && (
            <section className="surface settings-surface">
              <div className="settings-section-heading">
                <h2>{t('Dados e backups')}</h2>
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
                  {formatNumber(size / 1024, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}{' '}
                  KB
                </strong>
              </div>
              <div className="settings-backup-actions">
                <Button
                  variant="outline"
                  onClick={() => {
                    download(
                      `fedexe-backup-${new Date().toISOString().slice(0, 10)}.json`,
                      JSON.stringify(exportableWorkspace(workspace), null, 2),
                    );
                    onBackup();
                  }}
                >
                  <ArrowDownToLine size={15} />
                  {' ' + t('Exportar backup')}
                </Button>
                <Button variant="outline" onClick={onImport}>
                  <FileJson2 size={15} />
                  {' ' + t('Importar dados')}
                </Button>
                {onDrive && (
                  <Button variant="outline" onClick={onDrive}>
                    {t('Backups no Google Drive')}
                  </Button>
                )}
              </div>
              <p className="field-hint">
                {native
                  ? t(
                      'O workspace é salvo em um arquivo JSON neste dispositivo. Segredos marcados ficam no Gerenciador de Credenciais do Windows.',
                    )
                  : t(
                      'O navegador salva o workspace localmente e mantém os segredos apenas na sessão.',
                    )}
              </p>
            </section>
          )}
          {section === 'Atualizações e sobre' && (
            <>
              {updates}
              <section className="about-card">
                <img className="brand-mark" src="/favicon.svg" alt="" />
                <div>
                  <h2>Fedexe API</h2>
                  <p>{t('Versão {0}', version)}</p>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
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
