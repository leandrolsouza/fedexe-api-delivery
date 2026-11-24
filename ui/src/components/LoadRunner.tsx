import { toast } from 'sonner';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, CheckCircle2, CircleAlert, Download, Play, Square } from 'lucide-react';
import { prepareCollection } from '../lib/collection-runner';
import { t, type Message } from '../lib/i18n';
import {
  prepareLoadVariables,
  runLoad,
  type LoadInterval,
  type LoadMetrics,
  type LoadOptions,
  type LoadReport,
} from '../lib/load-runner';
import {
  hasRunScripts,
  redactSecrets,
  type Collection,
  type Environment,
  type RequestDefaults,
  type RequestItem,
} from '../lib/models';
import { native, normalizeError } from '../lib/transport';
import { download } from '../lib/utils';
import { Button } from './ui/button';
import { LoadResults, LoadMetricSummary, formatLoadTime } from './LoadResults';
import { LoadTimeline } from './LoadTimeline';

const profiles = {
  constant: 'Constante',
  ramp: 'Rampa gradual',
  spike: 'Pico repentino',
  soak: 'Longa duração',
} as const;

type NumericField = Exclude<keyof LoadOptions, 'profile' | 'skip_scripts' | 'collection_setup'>;
type Field = [NumericField, Message, number, number, number?];
const fields: Field[] = [
  ['vus', 'Usuários virtuais (VUs)', 1, 500],
  ['duration_seconds', 'Duração total (s)', 1, 86400],
  ['base_vus', 'VUs de base', 1, 499],
  ['phase_seconds', 'Duração da fase (s)', 1, 86399],
  ['think_ms', 'Pausa entre requisições (ms)', 0, 60000],
  ['max_p99_ms', 'Limite de p99 (ms)', 0, 3600000],
  ['max_error_percent', 'Limite de erros (%)', 0, 100, 0],
];

type Props = {
  requestPicker?: ReactNode;
  exportRequestIds?: string[];
  showResults: boolean;
  onShowResults: (show: boolean) => void;
  context: string;
  collection?: Collection;
  environment?: Environment;
  requests: RequestItem[];
  defaults: RequestDefaults;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onCancel: () => void;
  onOpenRequest: (collectionId: string, requestId: string) => void;
};

export function LoadRunner({
  requestPicker,
  exportRequestIds,
  showResults,
  onShowResults,
  context,
  collection,
  environment,
  requests,
  defaults,
  busy,
  setBusy,
  onCancel,
  onOpenRequest,
}: Props) {
  const [profile, setProfile] = useState<LoadOptions['profile']>('constant');
  const [values, setValues] = useState<Record<NumericField, string>>({
    vus: '5',
    duration_seconds: '30',
    base_vus: '1',
    phase_seconds: '10',
    think_ms: '100',
    max_p99_ms: '',
    max_error_percent: '',
  });
  const [metrics, setMetrics] = useState<LoadMetrics>();
  const [timeline, setTimeline] = useState<LoadInterval[]>([]);
  const [resultTab, setResultTab] = useState<'summary' | 'timeline'>('summary');
  const [runNumber, setRunNumber] = useState(0);
  const [report, setReport] = useState<LoadReport>();
  const [runContext, setRunContext] = useState('');
  const [runRequests, setRunRequests] = useState<
    { collectionId: string; id: string; name: string }[]
  >([]);
  const requestNames = runRequests.map(({ name }) => name);
  const preparationFailure = report?.preparation_failure;
  const failedRequest = preparationFailure ? runRequests[preparationFailure.step - 1] : undefined;
  const canOpenFailedRequest =
    failedRequest &&
    collection?.id === failedRequest.collectionId &&
    collection.requests.some(({ id }) => id === failedRequest.id);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [approvedScriptScope, setApprovedScriptScope] = useState('');
  const [setupScope, setSetupScope] = useState('');
  const setupController = useRef<AbortController>(null);
  const [preparing, setPreparing] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  useEffect(() => {
    if (focusHeading.current) {
      heading.current?.focus();
      focusHeading.current = false;
    }
  }, [showResults]);

  function navigateToResults(show: boolean) {
    focusHeading.current = true;
    onShowResults(show);
  }

  const scripts = hasRunScripts(collection, requests);
  const scriptScope = JSON.stringify([
    context,
    collection?.id,
    environment?.id,
    requests.map(({ id }) => id),
  ]);
  const skipScripts = scripts && approvedScriptScope === scriptScope;
  const hasSetup = Boolean(collection?.scripts?.before?.trim());
  const collectionSetup = hasSetup && setupScope === scriptScope;
  const scriptsBlockRun = scripts && !skipScripts && !collectionSetup;
  const phased = profile === 'ramp' || profile === 'spike';
  const visibleFields = fields.filter(
    ([key]) => phased || (key !== 'base_vus' && key !== 'phase_seconds'),
  );
  const options: LoadOptions = {
    profile,
    vus: Number(values.vus),
    duration_seconds: Number(values.duration_seconds),
    base_vus: phased ? Number(values.base_vus) : 1,
    phase_seconds: phased ? Number(values.phase_seconds) : 0,
    think_ms: Number(values.think_ms),
    skip_scripts: skipScripts || collectionSetup || undefined,
    collection_setup: collectionSetup || undefined,
    max_p99_ms: values.max_p99_ms === '' ? undefined : Number(values.max_p99_ms),
    max_error_percent:
      values.max_error_percent === '' ? undefined : Number(values.max_error_percent),
  };
  const rangeInvalid = visibleFields.some(([key, , min, max, anyStep]) => {
    const value = options[key];
    if (value === undefined) return false;
    return (
      values[key] === '' ||
      value < min ||
      value > max ||
      (anyStep === undefined ? !Number.isInteger(value) : !Number.isFinite(value))
    );
  });
  const phaseInvalid =
    phased &&
    (options.base_vus >= options.vus ||
      options.duration_seconds - options.phase_seconds < (profile === 'spike' ? 2 : 1));
  async function execute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !native ||
      !collection ||
      !environment ||
      !requests.length ||
      busy ||
      scriptsBlockRun ||
      rangeInvalid ||
      phaseInvalid
    )
      return;
    setBusy(true);
    setRunning(true);
    setMetrics(undefined);
    setTimeline([]);
    setRunNumber((number) => number + 1);
    setReport(undefined);
    setRunContext(context);
    setRunRequests(requests.map(({ id, name }) => ({ collectionId: collection.id, id, name })));
    navigateToResults(true);
    try {
      const flow = prepareCollection(collection, environment, requests, false, false, defaults);
      if (collectionSetup) {
        const controller = new AbortController();
        setupController.current = controller;
        setPreparing(true);
        await prepareLoadVariables(
          collection,
          environment,
          requests[0],
          flow.variables,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        setupController.current = null;
        setPreparing(false);
      }
      const result = await runLoad(flow, options, ({ interval, ...metrics }) => {
        setMetrics(metrics);
        if (interval) setTimeline((points) => [...points, interval]);
      });
      setMetrics(result.metrics);
      setTimeline(result.timeline);
      setReport(result);
    } catch (cause) {
      if (setupController.current?.signal.aborted) toast.info(t('Execução cancelada.'));
      else toast.error(redactSecrets(normalizeError(cause).message, environment));
    } finally {
      setupController.current = null;
      setPreparing(false);
      setCancelling(false);
      setRunning(false);
      setBusy(false);
    }
  }

  const verdict =
    report &&
    (report.outcome === 'cancelled'
      ? t('Execução cancelada')
      : report.outcome === 'preparation_error'
        ? t('Não foi possível preparar uma requisição do fluxo.')
        : report.metrics.requests === 0
          ? t('Nenhuma requisição concluída.')
          : report.exit_code === 1
            ? t('Limites excedidos')
            : report.p99_passed === true || report.error_rate_passed === true
              ? t('Limites atendidos')
              : t('Execução concluída'));

  return (
    <>
      <header className="surface-heading load-screen-heading">
        <h2 ref={heading} tabIndex={-1}>
          {t(showResults ? 'Resultados do teste de carga' : 'Teste de carga')}
        </h2>
        {showResults ? (
          <div className="load-actions">
            {report && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => download('fedexe-load-report.json', JSON.stringify(report, null, 2))}
              >
                <Download size={14} /> {t('Exportar relatório de carga')}
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={() => navigateToResults(false)}>
              <ArrowLeft size={15} /> {t('Voltar à configuração')}
            </Button>
          </div>
        ) : (
          (running || report) && (
            <Button type="button" variant="secondary" onClick={() => navigateToResults(true)}>
              {t('Ver resultados')}
            </Button>
          )
        )}
      </header>
      <form onSubmit={execute} className="runner-fields" hidden={showResults}>
        <label className="field-label">
          {t('Perfil de carga')}
          <select
            className="input"
            disabled={busy}
            value={profile}
            onChange={(event) => setProfile(event.target.value as LoadOptions['profile'])}
          >
            {Object.entries(profiles).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <div className="runner-timing-fields load-fields">
          {visibleFields.map(([key, label, min, max, anyStep]) => (
            <label key={key} className="field-label">
              {t(label)}
              <input
                className="input"
                type="number"
                min={min}
                max={max}
                step={anyStep === 0 ? 'any' : 1}
                required={!key.startsWith('max_')}
                disabled={busy}
                value={values[key]}
                onChange={(event) => setValues({ ...values, [key]: event.target.value })}
              />
            </label>
          ))}
        </div>
        {phased && (
          <p className="field-hint">
            {t(
              profile === 'ramp'
                ? 'A rampa começa com os VUs de base e atinge o total ao fim da fase.'
                : 'O pico usa o total de VUs no centro da execução, com carga de base antes e depois.',
            )}
          </p>
        )}
        {phaseInvalid && (
          <p className="field-hint">
            {t('Use menos VUs de base que o total e reserve tempo fora da fase.')}
          </p>
        )}
        {!native && (
          <p className="field-hint">{t('Execute testes de carga no app desktop ou pelo CLI.')}</p>
        )}
        {scripts && (
          <div className="load-script-choice">
            <p className="field-hint">
              {t(
                'O fluxo selecionado contém JavaScript. Se um script prepara a autenticação ou os dados, configure essas etapas na coleção antes de rodar sem scripts.',
              )}
            </p>
            <label>
              <input
                type="checkbox"
                disabled={busy}
                checked={skipScripts}
                onChange={(event) => {
                  setApprovedScriptScope(event.target.checked ? scriptScope : '');
                  setSetupScope('');
                }}
              />{' '}
              {t('Executar este teste de carga sem scripts JavaScript')}
            </label>
            {hasSetup && (
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={collectionSetup}
                  onChange={(event) => {
                    setSetupScope(event.target.checked ? scriptScope : '');
                    setApprovedScriptScope('');
                  }}
                />
                {t('Rodar o pré-script da coleção uma vez antes da carga')}
              </label>
            )}
            {collectionSetup && (
              <p className="field-hint">
                {t(
                  'Os usuários virtuais compartilham as variáveis preparadas. O token não é renovado e esta opção está disponível no desktop.',
                )}
              </p>
            )}
          </div>
        )}
        <div className="load-actions">
          <Button
            type="submit"
            disabled={
              !native ||
              busy ||
              scriptsBlockRun ||
              rangeInvalid ||
              phaseInvalid ||
              !environment ||
              !requests.length
            }
          >
            <Play size={14} /> {t('Iniciar teste de carga')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={
              busy ||
              rangeInvalid ||
              phaseInvalid ||
              scriptsBlockRun ||
              collectionSetup ||
              exportRequestIds?.length === 0
            }
            onClick={() =>
              download(
                'fedexe-load-scenario.json',
                JSON.stringify({ ...options, request_ids: exportRequestIds }, null, 2),
              )
            }
          >
            <Download size={14} /> {t('Exportar cenário')}
          </Button>
        </div>
        {requestPicker}
      </form>
      <div className="runner-fields" hidden={!showResults}>
        {runContext && <p className="field-hint">{runContext}</p>}
        {running && (
          <p role="status">
            {t(preparing ? 'Executando o pré-script da coleção…' : 'Teste de carga em andamento')}
          </p>
        )}
        {verdict && !preparationFailure && (
          <div className="load-run-status" role="status">
            <span>
              {report?.outcome === 'completed' && report.exit_code !== 1 ? (
                <CheckCircle2 size={16} aria-hidden="true" />
              ) : (
                <CircleAlert size={16} aria-hidden="true" />
              )}{' '}
              {verdict}
            </span>
            {metrics && (
              <span className="load-duration">
                {t('Duração')}: {formatLoadTime(metrics.duration_ms)}
              </span>
            )}
          </div>
        )}
        {preparationFailure && (
          <section
            className="load-preparation-diagnostic"
            aria-label={t('Execução interrompida na etapa {0}', preparationFailure.step)}
          >
            <div className="load-diagnostic-heading" role="status">
              <h3>
                <CircleAlert size={18} aria-hidden="true" />
                {t('Execução interrompida na etapa {0}', preparationFailure.step)}
              </h3>
              {metrics && (
                <span className="load-duration">
                  {t('Duração')}: {formatLoadTime(metrics.duration_ms)}
                </span>
              )}
            </div>
            <p>
              {failedRequest
                ? t('Não foi possível preparar a requisição {0}.', failedRequest.name)
                : t('Não foi possível preparar uma requisição do fluxo.')}
            </p>
            {preparationFailure.missing_variable && (
              <p>
                {t('Variável não definida:')}{' '}
                <code data-variable-reference={preparationFailure.missing_variable} tabIndex={0}>
                  {preparationFailure.missing_variable}
                </code>
              </p>
            )}
            {preparationFailure.missing_variable && (
              <p className="load-diagnostic-hint">
                {t('Confira o ambiente selecionado ou a etapa que deveria criar essa variável.')}
              </p>
            )}
            {canOpenFailedRequest && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onOpenRequest(failedRequest.collectionId, failedRequest.id)}
              >
                {t('Abrir requisição')}
              </Button>
            )}
          </section>
        )}
        {(running || metrics || report) && (
          <div className="runner-tabs" role="tablist" aria-label={t('Resultados da execução')}>
            {(['summary', 'timeline'] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                id={`load-tab-${tab}`}
                role="tab"
                aria-controls={`load-panel-${tab}`}
                aria-selected={resultTab === tab}
                tabIndex={resultTab === tab ? 0 : -1}
                onClick={() => setResultTab(tab)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 'summary'
                      : event.key === 'End' || tab === 'summary'
                        ? 'timeline'
                        : 'summary';
                  setResultTab(next);
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>(`#load-tab-${next}`)
                    ?.focus();
                }}
              >
                {t(tab === 'summary' ? 'Resumo' : 'Evolução')}
              </button>
            ))}
          </div>
        )}
        {(running || metrics || report) && (
          <>
            <div
              id="load-panel-summary"
              className="load-summary"
              role="tabpanel"
              aria-labelledby="load-tab-summary"
              hidden={resultTab !== 'summary'}
              tabIndex={0}
            >
              {metrics && <LoadMetricSummary metrics={metrics} />}
              {report && <LoadResults report={report} requestNames={requestNames} />}
            </div>
            <div
              id="load-panel-timeline"
              role="tabpanel"
              aria-labelledby="load-tab-timeline"
              hidden={resultTab !== 'timeline'}
              tabIndex={0}
            >
              <LoadTimeline key={runNumber} points={timeline} />
            </div>
          </>
        )}
        {running && (
          <div className="load-actions">
            {running && (
              <Button
                type="button"
                variant="secondary"
                disabled={cancelling}
                onClick={() => {
                  setCancelling(true);
                  setupController.current?.abort();
                  onCancel();
                }}
              >
                <Square size={14} /> {cancelling ? t('Cancelando…') : t('Cancelar execução')}
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
