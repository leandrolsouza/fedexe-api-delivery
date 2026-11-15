import { useState } from 'react';
import { formatDate, formatNumber, t, type Message } from '../lib/i18n';
import {
  clearRequestConsole,
  useRequestConsole,
  type ConsoleSource,
  type ConsoleTrace,
} from '../lib/request-console';
import { Button } from './ui/button';

const sourceLabels = { editor: 'Editor', runner: 'Runner de coleções' } as const;
const failureLabels: Record<NonNullable<ConsoleTrace['failure']>, Message> = {
  preparation: 'Falha na preparação da requisição',
  resolution: 'Falha na resolução de variáveis ou parâmetros de caminho',
  connection: 'Falha na conexão',
  transmission: 'Falha no envio da requisição',
  timeout: 'A requisição excedeu o timeout configurado.',
  redirect: 'Falha no redirecionamento',
  response: 'Falha ao ler a resposta',
  validation: 'Falha na validação ou extração',
  cancelled: 'Execução cancelada.',
};

function Headers({ values }: { values: [string, string][] }) {
  return (
    values.length > 0 && (
      <dl className="console-headers">
        {values.map(([name, value], index) => (
          <div key={index}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    )
  );
}

export function RequestConsole() {
  const entries = useRequestConsole();
  const [source, setSource] = useState<ConsoleSource | 'all'>('all');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const filtered = entries.filter(
    (entry) =>
      (source === 'all' || entry.source === source) &&
      (!errorsOnly || entry.failure || (entry.response?.status ?? 0) >= 400),
  );

  return (
    <section className="request-console">
      <h1>{t('Console de requisições')}</h1>
      <div className="console-controls">
        <label>
          {t('Origem')}
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as typeof source)}
          >
            <option value="all">{t('Todas as origens')}</option>
            <option value="editor">{t(sourceLabels.editor)}</option>
            <option value="runner">{t(sourceLabels.runner)}</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(event) => setErrorsOnly(event.target.checked)}
          />
          {t('Somente erros')}
        </label>
        <Button variant="outline" onClick={clearRequestConsole} disabled={!entries.length}>
          {t('Limpar console')}
        </Button>
      </div>
      {!filtered.length && (
        <p>{t(entries.length ? 'Nenhum resultado encontrado' : 'Nenhum envio registrado.')}</p>
      )}
      <div className="console-entries">
        {filtered.map((entry) => (
          <details key={entry.id} className="console-entry">
            <summary>
              <time dateTime={entry.date}>
                {formatDate(entry.date, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </time>
              <span>
                {t(sourceLabels[entry.source])}
                {entry.step !== null && ` · ${t('Etapa {0}', entry.step)}`}
              </span>
              {entry.request && (
                <code>
                  {entry.request.method} {entry.request.url}
                </code>
              )}
              <span>{entry.response?.status ?? '—'}</span>
              <span>{formatNumber(entry.duration_ms)} ms</span>
              {entry.failure && <span>{t(failureLabels[entry.failure])}</span>}
            </summary>
            <div className="console-details">
              {entry.request && (
                <section>
                  <h2>{t('Headers da requisição')}</h2>
                  <Headers values={entry.request.headers} />
                </section>
              )}
              {entry.redirects.length > 0 && (
                <section>
                  <h2>{t('Redirecionamentos')}</h2>
                  <ol>
                    {entry.redirects.map((redirect, index) => (
                      <li key={index}>
                        <code>
                          {redirect.status} {redirect.url}
                        </code>
                        {' · ' + t(redirect.followed ? 'Seguido' : 'Não seguido')}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {entry.response && (
                <section>
                  <h2>{t('Headers da resposta')}</h2>
                  <Headers values={entry.response.headers} />
                  <h2>{t('Prévia da resposta')}</h2>
                  {entry.response.preview && <pre>{entry.response.preview}</pre>}
                  {entry.response.truncated && <p>{t('Prévia incompleta ou indisponível.')}</p>}
                </section>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
