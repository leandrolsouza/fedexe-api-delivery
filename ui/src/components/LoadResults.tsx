import { ChevronRight, CircleAlert } from 'lucide-react';
import { formatNumber, t } from '../lib/i18n';
import type { LoadMetrics, LoadReport } from '../lib/load-runner';

export function formatLoadTime(value: number | null) {
  if (value === null) return '—';
  return value >= 1000
    ? `${formatNumber(value / 1000, { maximumFractionDigits: 2 })} s`
    : `${formatNumber(value, { maximumFractionDigits: 2 })} ms`;
}

export function LoadMetricSummary({ metrics }: { metrics: LoadMetrics }) {
  const primary = [
    [t('Requisições'), formatNumber(metrics.requests)],
    [
      t('Taxa de erros'),
      metrics.error_percent === null
        ? '—'
        : `${formatNumber(metrics.error_percent, { maximumFractionDigits: 2 })}%`,
    ],
    [t('Requisições/s (RPS)'), formatNumber(metrics.rps, { maximumFractionDigits: 2 })],
    [t('Latência p95'), formatLoadTime(metrics.p95_ms)],
  ];
  const secondary = [
    [t('Latência média'), formatLoadTime(metrics.mean_ms)],
    [t('Latência p99'), formatLoadTime(metrics.p99_ms)],
    [t('Respostas HTTP 4xx/5xx'), formatNumber(metrics.http_errors)],
    [t('Erros de transporte'), formatNumber(metrics.transport_errors)],
    [t('Timeouts'), formatNumber(metrics.timeouts)],
    [t('Falhas de validação'), formatNumber(metrics.validation_failures)],
  ];
  return (
    <div className="load-metric-summary">
      <dl className="load-primary-metrics" aria-label={t('Métricas de carga')}>
        {primary.map(([label, value], index) => (
          <div
            key={label}
            className={index === 1 && (metrics.error_percent ?? 0) > 0 ? 'has-errors' : undefined}
          >
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <dl className="load-secondary-metrics">
        {secondary.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function LoadResults({
  report,
  requestNames,
}: {
  report: LoadReport;
  requestNames: string[];
}) {
  const thresholds = [
    { ...report.thresholds.p99_ms, label: t('p99 (ms)') },
    { ...report.thresholds.error_percent, label: t('Taxa de erros (%)') },
  ].filter(({ limit }) => limit !== null);
  const failures = report.requests_by_step
    .filter(({ errors, validation_failures }) => errors > 0 || validation_failures > 0)
    .sort(
      (a, b) =>
        b.errors - a.errors || b.validation_failures - a.validation_failures || a.step - b.step,
    );
  const formatValue = (value: number | null) =>
    value === null ? '—' : formatNumber(value, { maximumSignificantDigits: 15 });
  return (
    <>
      <section className="load-result-section">
        <h3>{t('Falhas por requisição')}</h3>
        {failures.length ? (
          <div className="load-failure-list">
            {failures.map((row) => {
              const httpErrors = Object.values(row.http_errors_by_status).reduce(
                (sum, count) => sum + count,
                0,
              );
              const cause =
                row.transport_errors >= httpErrors &&
                row.transport_errors >= row.validation_failures &&
                row.transport_errors > 0
                  ? t('Erros de transporte')
                  : httpErrors >= row.validation_failures && httpErrors > 0
                    ? t('Respostas HTTP 4xx/5xx')
                    : t('Falhas de validação');
              return (
                <details className="load-failure-item" key={row.step}>
                  <summary>
                    <ChevronRight size={16} className="load-failure-chevron" />
                    <div className="load-failure-title">
                      <strong>
                        {t('Etapa {0}', row.step)} · {requestNames[row.step - 1]}
                      </strong>
                      <span>
                        {row.errors > 0
                          ? t('{0} de {1} chamadas falharam', row.errors, row.requests)
                          : `${t('Falhas de validação')}: ${formatNumber(row.validation_failures)}`}
                      </span>
                    </div>
                    <span className="load-failure-cause">
                      <CircleAlert size={14} />
                      {cause}
                    </span>
                    <span className="load-failure-rate">
                      {row.error_percent === null
                        ? '—'
                        : `${formatNumber(row.error_percent, { maximumFractionDigits: 2 })}%`}
                      <span className="load-failure-track">
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, row.error_percent ?? 0))}%`,
                          }}
                        />
                      </span>
                    </span>
                  </summary>
                  <dl className="load-failure-details">
                    <div>
                      <dt>{t('Chamadas')}</dt>
                      <dd>{formatNumber(row.requests)}</dd>
                    </div>
                    <div>
                      <dt>{t('Erros de transporte')}</dt>
                      <dd>{formatNumber(row.transport_errors)}</dd>
                    </div>
                    <div>
                      <dt>{t('Falhas de validação')}</dt>
                      <dd>{formatNumber(row.validation_failures)}</dd>
                    </div>
                    <div>
                      <dt>{t('Erros por código HTTP')}</dt>
                      <dd>
                        {Object.entries(row.http_errors_by_status).map(([status, count]) => (
                          <span key={status}>
                            HTTP {status} × {formatNumber(count)}{' '}
                          </span>
                        ))}
                        {!httpErrors && '—'}
                      </dd>
                    </div>
                  </dl>
                </details>
              );
            })}
          </div>
        ) : (
          <p className="field-hint">
            {report.metrics.requests > 0
              ? t('Nenhuma falha registrada.')
              : t('Nenhuma requisição concluída.')}
          </p>
        )}
      </section>
      <section className="load-result-section">
        <h3>{t('Critérios de aceite')}</h3>
        {!thresholds.length ? (
          <p className="load-no-thresholds">{t('Nenhum limite de aprovação configurado.')}</p>
        ) : (
          <div className="load-table-scroll">
            <table className="load-result-table load-threshold-table">
              <thead>
                <tr>
                  <th scope="col">{t('Critério')}</th>
                  <th scope="col">{t('Medido')}</th>
                  <th scope="col">{t('Limite máximo')}</th>
                  <th scope="col">{t('Veredito')}</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.map(({ label, measured, limit, passed }) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{formatValue(measured)}</td>
                    <td>≤ {formatValue(limit)}</td>
                    <td>
                      <span
                        className={`load-verdict ${passed === null ? '' : passed ? 'load-passed' : 'load-failed'}`}
                      >
                        {t(passed === null ? 'Não avaliado' : passed ? 'Aprovado' : 'Reprovado')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
