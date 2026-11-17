import { formatNumber, t } from '../lib/i18n';
import type { LoadReport } from '../lib/load-runner';

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
  ];
  const failures = report.requests_by_step
    .filter(({ errors, validation_failures }) => errors > 0 || validation_failures > 0)
    .sort(
      (a, b) =>
        b.errors - a.errors || b.validation_failures - a.validation_failures || a.step - b.step,
    );
  const formatValue = (value: number | null, digits = 15) =>
    value === null ? '—' : formatNumber(value, { maximumSignificantDigits: digits });

  return (
    <>
      <div className="load-table-scroll">
        <table className="load-result-table">
          <caption>{t('Critérios de aceite')}</caption>
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
                <td>
                  {formatValue(
                    measured,
                    measured !== limit && formatValue(measured, 5) === formatValue(limit, 5)
                      ? 15
                      : 5,
                  )}
                </td>
                <td>{limit === null ? '—' : `≤ ${formatValue(limit)}`}</td>
                <td
                  className={passed === null ? undefined : passed ? 'load-passed' : 'load-failed'}
                >
                  {t(
                    limit === null
                      ? 'Sem limite'
                      : passed === null
                        ? 'Não avaliado'
                        : passed
                          ? 'Aprovado'
                          : 'Reprovado',
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {failures.length > 0 ? (
        <div className="load-table-scroll">
          <table className="load-result-table">
            <caption>{t('Falhas por requisição')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('Requisição')}</th>
                <th scope="col">{t('Chamadas')}</th>
                <th scope="col">{t('Erros HTTP ou de transporte')}</th>
                <th scope="col">{t('Taxa de erros (%)')}</th>
                <th scope="col">{t('Erros por código HTTP')}</th>
                <th scope="col">{t('Erros de transporte')}</th>
                <th scope="col">{t('Etapas com falha de validação')}</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((row) => (
                <tr key={row.step}>
                  <th scope="row">
                    {t('Etapa {0}', row.step)} · {requestNames[row.step - 1]}
                  </th>
                  <td>{formatNumber(row.requests)}</td>
                  <td>{formatNumber(row.errors)}</td>
                  <td>
                    {row.error_percent === null
                      ? '—'
                      : formatNumber(row.error_percent, { maximumFractionDigits: 2 })}
                  </td>
                  <td>
                    {Object.keys(row.http_errors_by_status).length === 0 ? (
                      '—'
                    ) : (
                      <ul className="load-http-counts">
                        {Object.entries(row.http_errors_by_status).map(([status, count]) => (
                          <li key={status}>
                            {status} × {formatNumber(count)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{formatNumber(row.transport_errors)}</td>
                  <td>{formatNumber(row.validation_failures)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        report.metrics.requests > 0 && (
          <p className="field-hint">{t('Nenhuma falha registrada.')}</p>
        )
      )}
    </>
  );
}
