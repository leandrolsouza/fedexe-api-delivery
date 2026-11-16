import { useState, type FormEvent } from 'react';
import { Download, Play, Square } from 'lucide-react';
import { prepareCollection } from '../lib/collection-runner';
import { formatNumber, t, type Message } from '../lib/i18n';
import { runLoad, type LoadMetrics, type LoadOptions, type LoadReport } from '../lib/load-runner';
import { redactSecrets, type Collection, type Environment, type RequestItem } from '../lib/models';
import { hasScripts } from '../lib/scripts';
import { native, normalizeError } from '../lib/transport';
import { download } from '../lib/utils';
import { Button } from './ui/button';

const profiles = {
  constant: 'Constante',
  ramp: 'Rampa gradual',
  spike: 'Pico repentino',
  soak: 'Longa duração',
} as const;

type NumericField = Exclude<keyof LoadOptions, 'profile'>;
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

const metricLabels: Record<keyof LoadMetrics, Message> = {
  duration_ms: 'Duração (ms)',
  requests: 'Requisições concluídas',
  rps: 'Requisições/s (RPS)',
  mean_ms: 'Latência média (ms)',
  p95_ms: 'p95 (ms)',
  p99_ms: 'p99 (ms)',
  error_percent: 'Taxa de erros (%)',
  http_errors: 'Respostas HTTP 4xx/5xx',
  transport_errors: 'Erros de transporte',
  timeouts: 'Timeouts',
  validation_failures: 'Etapas com falha de validação',
};

type Props = {
  context: string;
  collection?: Collection;
  environment?: Environment;
  requests: RequestItem[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onCancel: () => void;
};

export function LoadRunner({
  context,
  collection,
  environment,
  requests,
  busy,
  setBusy,
  onCancel,
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
  const [report, setReport] = useState<LoadReport>();
  const [error, setError] = useState('');
  const [runContext, setRunContext] = useState('');
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
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
  const scripts =
    hasScripts(collection?.scripts) || requests.some((request) => hasScripts(request.scripts));

  async function execute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !native ||
      !collection ||
      !environment ||
      !requests.length ||
      busy ||
      scripts ||
      rangeInvalid ||
      phaseInvalid
    )
      return;
    setBusy(true);
    setRunning(true);
    setMetrics(undefined);
    setReport(undefined);
    setError('');
    setRunContext(context);
    try {
      const result = await runLoad(
        prepareCollection(collection, environment, requests, false),
        options,
        setMetrics,
      );
      setMetrics(result.metrics);
      setReport(result);
    } catch (cause) {
      setError(redactSecrets(normalizeError(cause).message, environment));
    } finally {
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
    <form onSubmit={execute} className="runner-fields">
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
        <p className="field-hint">
          {t('Selecione um fluxo sem scripts JavaScript para o teste de carga.')}
        </p>
      )}
      <div className="load-actions">
        {running ? (
          <Button
            type="button"
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
          <Button
            type="submit"
            disabled={
              !native ||
              busy ||
              scripts ||
              rangeInvalid ||
              phaseInvalid ||
              !environment ||
              !requests.length
            }
          >
            <Play size={14} /> {t('Iniciar teste de carga')}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          disabled={busy || rangeInvalid || phaseInvalid}
          onClick={() => download('fedexe-load-scenario.json', JSON.stringify(options, null, 2))}
        >
          <Download size={14} /> {t('Exportar cenário')}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {runContext && <p className="field-hint">{runContext}</p>}
      {running && <p role="status">{t('Teste de carga em andamento')}</p>}
      {verdict && <p role="status">{verdict}</p>}
      {metrics && (
        <dl className="load-metrics" aria-label={t('Métricas de carga')}>
          {(Object.keys(metricLabels) as (keyof LoadMetrics)[]).map((key) => (
            <div key={key}>
              <dt>{t(metricLabels[key])}</dt>
              <dd>
                {metrics[key] === null
                  ? '—'
                  : formatNumber(metrics[key], { maximumFractionDigits: 2 })}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {report && (
        <div className="load-actions">
          {report.p99_passed !== null && (
            <span>{t(report.p99_passed ? 'p99 aprovado' : 'p99 reprovado')}</span>
          )}
          {report.error_rate_passed !== null && (
            <span>
              {t(report.error_rate_passed ? 'Taxa de erros aprovada' : 'Taxa de erros reprovada')}
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => download('fedexe-load-report.json', JSON.stringify(report, null, 2))}
          >
            <Download size={14} /> {t('Exportar relatório de carga')}
          </Button>
        </div>
      )}
    </form>
  );
}
