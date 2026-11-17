import { useState } from 'react';
import { formatDate, formatNumber, t, type Message } from '../lib/i18n';
import type { Collection } from '../lib/models';
import {
  clearRequestConsole,
  consoleAttemptHasError,
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

export function RequestConsole({
  collections,
  onOpenRequest,
}: {
  collections: Collection[];
  onOpenRequest: (collectionId: string, requestId: string) => void;
}) {
  const attempts = useRequestConsole();
  const [source, setSource] = useState<ConsoleSource | 'all'>('all');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const filtered = attempts.filter(
    (attempt) =>
      (source === 'all' || attempt.source === source) &&
      (!errorsOnly || consoleAttemptHasError(attempt)),
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
        <Button variant="outline" onClick={clearRequestConsole} disabled={!attempts.length}>
          {t('Limpar console')}
        </Button>
      </div>
      {!filtered.length && (
        <p>{t(attempts.length ? 'Nenhum resultado encontrado' : 'Nenhum envio registrado.')}</p>
      )}
      <div className="console-entries">
        {filtered.map((attempt) => {
          const { requestId, events } = attempt;
          const collection = collections.find((item) =>
            item.requests.some((request) => request.id === requestId),
          );
          const request = collection?.requests.find((item) => item.id === requestId);
          const http = events.find((event) => event.type === 'http')?.trace;
          const warnings = events.filter(
            (event) => event.type === 'script' && event.script.level === 'warn',
          ).length;
          const scriptError = events.some(
            (event) => event.type === 'script' && event.script.level === 'error',
          );
          const skipped = events.some((event) => event.type === 'skipped');
          return (
            <details key={attempt.id} className="console-entry">
              <summary>
                <time dateTime={attempt.date}>
                  {formatDate(attempt.date, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </time>
                <span>
                  {t(sourceLabels[attempt.source])}
                  {attempt.step !== null && ` · ${t('Etapa {0}', attempt.step)}`}
                </span>
                <strong>
                  {request?.name ??
                    (http?.request
                      ? `${http.request.method} ${http.request.url}`
                      : t('Requisição'))}
                </strong>
                {http?.response && <span>{http.response.status}</span>}
                {http && <span>{formatNumber(http.duration_ms)} ms</span>}
                {http?.failure && <span>{t(failureLabels[http.failure])}</span>}
                {skipped && <span>{t('Ignorada')}</span>}
                {scriptError && <span>{t('Erro no script')}</span>}
                {warnings > 0 && (
                  <span>
                    {t(warnings === 1 ? '{0} aviso' : '{0} avisos', formatNumber(warnings))}
                  </span>
                )}
              </summary>
              <div className="console-attempt-events">
                {collection && requestId && (
                  <button
                    type="button"
                    className="console-request-link"
                    onClick={() => onOpenRequest(collection.id, requestId)}
                  >
                    {t('Abrir requisição')}
                  </button>
                )}
                {events.map((event, index) => {
                  if (event.type === 'skipped')
                    return <p key={index}>{t('Requisição ignorada pelo script.')}</p>;
                  if (event.type === 'http') return <HttpEvent key={index} trace={event.trace} />;
                  const { label, level, message } = event.script;
                  return (
                    <div key={index} className="console-script">
                      <span>{label}</span>
                      <code>{level}</code>
                      <pre>{message}</pre>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function HttpEvent({ trace: entry }: { trace: ConsoleTrace }) {
  return (
    <div className="console-http-event">
      <div className="console-http-summary">
        <strong>{t('Requisição principal')}</strong>
        {entry.request && (
          <code>
            {entry.request.method} {entry.request.url}
          </code>
        )}
        {entry.response && <span>{entry.response.status}</span>}
        {entry.failure && <span>{t(failureLabels[entry.failure])}</span>}
      </div>
      <div className="console-details">
        {entry.request && (
          <section>
            <h2>{t('Headers da requisição')}</h2>
            <Headers values={entry.request.headers} />
            {entry.request.body && (
              <>
                <h2>{t('Corpo da requisição')}</h2>
                {entry.request.body.preview && <pre>{entry.request.body.preview}</pre>}
                {entry.request.body.truncated && <p>{t('Prévia incompleta ou indisponível.')}</p>}
              </>
            )}
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
            {entry.response.status === 204 ? (
              <p>{t('Resposta sem corpo.')}</p>
            ) : entry.response.hiddenByPostResponseScript ? (
              <p>{t('Resposta ocultada por um script de pós-resposta.')}</p>
            ) : (
              <>
                {entry.response.preview && <pre>{entry.response.preview}</pre>}
                {entry.response.truncated && <p>{t('Prévia incompleta ou indisponível.')}</p>}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
