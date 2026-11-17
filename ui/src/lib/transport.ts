import { localizeNativeMessage } from './native-messages';
import { t } from './i18n';
import { runScripts } from './scripts';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { checkResponse, isJsonPointer, jsonPointer, responseJson } from './response-tests';
import { consoleAttemptFactory, postResponseTrace, type ConsoleTrace } from './request-console';
import {
  resolveHttpRequest,
  addConsoleMasks,
  compileRequest,
  redactValues,
  type Collection,
  type Environment,
  type RequestItem,
  type RequestDefaults,
  DEFAULT_TIMEOUT_MS,
  type HttpRequest,
  type HttpResponse,
  type NativeCollection,
  type OAuthProvider,
  type RunFailureReason,
  type RunResult,
  type RunRow,
} from './models';

let controller: AbortController | undefined;
const skippedRequest = Symbol();
export const native = isTauri();

export async function saveResponseBody(id: string, json: boolean) {
  return invoke<boolean>('save_response_body', {
    id,
    filename: t('resposta') + (json ? '.json' : '.bin'),
    title: t('Salvar corpo completo'),
  });
}

export async function releaseResponseBodies(ids: string[]) {
  if (ids.length) await invoke('release_response_bodies', { ids });
}

export async function updateOAuthSession(
  action: 'connect' | 'disconnect',
  provider: OAuthProvider,
) {
  try {
    await invoke(action === 'connect' ? 'oauth_connect' : 'oauth_disconnect', { provider });
  } catch (error) {
    throw normalizeError(error);
  }
}

function checkBrowserRequest(request: HttpRequest) {
  if (request.oauth) throw new Error(t('OAuth 2.0 está disponível no app desktop e na CLI.'));
  if (request.multipart !== undefined || request.binary_file !== undefined)
    throw new Error(t('Corpos multipart e binários estão disponíveis no app desktop.'));
  if (request.redirect_policy === 'same_origin')
    throw new Error(t('Para seguir redirecionamentos da mesma origem, execute no app desktop.'));
}

async function browserSend(
  request: HttpRequest,
  limit: number | null = 256 * 1024,
  signal = controller?.signal,
): Promise<HttpResponse> {
  const start = performance.now();
  const timeout = AbortSignal.timeout(request.timeout_ms ?? DEFAULT_TIMEOUT_MS);
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: 'error',
    credentials: 'omit',
  });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0,
    truncated = false;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (limit === null) continue;
        const remaining = limit - total;
        chunks.push(value.subarray(0, remaining));
        total += Math.min(value.length, remaining);
        if (value.length > remaining) {
          truncated = true;
          await reader.cancel();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.length;
  });
  return {
    status: response.status,
    duration_ms: Math.round(performance.now() - start),
    headers: [...response.headers],
    preview: new TextDecoder().decode(bytes),
    truncated,
  };
}

export async function pickBodyFile() {
  return invoke<string | null>('pick_body_file', { title: t('Selecionar arquivo') });
}

export async function send(request: HttpRequest, record?: (trace: ConsoleTrace) => void) {
  controller = new AbortController();
  try {
    if (native)
      return await invoke<HttpResponse>('send', {
        request,
        console: new Channel<ConsoleTrace>(record),
      });
    checkBrowserRequest(request);
    return await browserSend(request);
  } catch (error) {
    throw normalizeError(error);
  } finally {
    controller = undefined;
  }
}

export async function clearSessionCookies() {
  await invoke('clear_session_cookies');
}

export async function sendScriptRequest(
  request: HttpRequest,
  signal?: AbortSignal,
  useRunnerCookies = false,
) {
  signal?.throwIfAborted();
  if (!native) {
    checkBrowserRequest(request);
    return browserSend(request, 256 * 1024, signal);
  }
  const console = new Channel<ConsoleTrace>();
  const response = await invoke<HttpResponse>('send', {
    request,
    useRunnerCookies,
    hideResponseDetails: true,
    console,
  });
  if (response.body_id) await releaseResponseBodies([response.body_id]);
  return response;
}

export async function cancel() {
  controller?.abort();
  if (native) await invoke('cancel');
}

type RunProgress =
  { type: 'started'; index: number } | { type: 'finished'; index: number; row: RunRow };

function waitBetweenRequests(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

export async function runCollection(
  collection: NativeCollection,
  onProgress: (event: RunProgress) => void,
  requestIds: readonly string[] = [],
  scripts?: {
    collection: Collection;
    environment: Environment;
    requests: RequestItem[];
    defaults?: RequestDefaults;
  },
): Promise<RunResult> {
  const { iterations = 1, delay_ms: delay = 0 } = collection;
  const requestCount = collection.requests.length;
  const startAttempt = native ? consoleAttemptFactory('runner') : undefined;
  if (startAttempt && !scripts) {
    const localizeRow = (row: RunRow) => ({
      ...row,
      failures: row.failures.map(localizeNativeMessage),
    });
    const progress = new Channel<RunProgress>((event) =>
      onProgress(event.type === 'finished' ? { ...event, row: localizeRow(event.row) } : event),
    );
    try {
      const result = await invoke<RunResult>('run', {
        collection,
        progress,
        console: new Channel<ConsoleTrace>((trace) => {
          const requestIndex = ((trace.step ?? 1) - 1) % requestCount;
          startAttempt(requestIds[requestIndex], trace.step).trace(trace);
        }),
      });
      return { ...result, results: result.results.map(localizeRow) };
    } finally {
      progress.onmessage = () => {};
    }
  }
  controller = new AbortController();
  const start = performance.now();
  const results: RunRow[] = [];
  let outcome: RunResult['outcome'] = 'completed';
  const changes = new Map<string, string | null>();
  const secretValues = [
    ...(scripts?.collection.variables ?? []),
    ...(scripts?.environment.variables ?? []),
  ]
    .filter(({ secret }) => secret)
    .map(({ value }) => value);
  const redact = (message: string) => redactValues(message, [...secretValues, ...changes.values()]);
  const initialVariables = (): Record<string, string> =>
    Object.assign(Object.create(null), collection.variables);
  let variables = initialVariables();
  const sendRunnerScriptRequest = (request: HttpRequest, signal?: AbortSignal) =>
    sendScriptRequest(request, signal, true);
  try {
    for (let index = 0; index < requestCount * iterations; index++) {
      const requestIndex = index % requestCount;
      const step = collection.requests[requestIndex];
      if (index > 0 && delay > 0 && !controller.signal.aborted) {
        await waitBetweenRequests(delay, controller.signal);
      }
      if (native && requestIndex === 0 && !controller.signal.aborted) {
        await invoke('reset_runner_cookies');
      }
      if (controller.signal.aborted) {
        outcome = 'cancelled';
        break;
      }
      if (index > 0 && requestIndex === 0) {
        variables = initialVariables();
        changes.clear();
      }
      onProgress({ type: 'started', index });
      const row: RunRow = {
        name: step.name,
        status: null,
        http_ms: 0,
        validation_ms: 0,
        checks_passed: 0,
        failures: [],
        failure_reasons: [],
      };
      const addFailure = (reason: RunFailureReason, message: string) => {
        row.failure_reasons.push(reason);
        row.failures.push(message);
      };
      let errorReason: RunFailureReason = 'preparation';
      const tick = performance.now();
      const attempt = startAttempt?.(requestIds[requestIndex], index + 1);
      let deferredTrace: ReturnType<typeof postResponseTrace> | undefined;
      try {
        let template = step.request;
        let item = scripts?.requests[requestIndex];
        if (scripts && item) {
          const scriptResults = (row.scriptResults = [] as NonNullable<RunRow['scriptResults']>);
          const {
            item: updated,
            failed,
            skipped,
          } = await runScripts(
            'before',
            scripts.collection,
            item,
            variables,
            changes,
            scriptResults,
            redact,
            undefined,
            {
              environmentName: scripts.environment.name,
              signal: controller.signal,
              send: sendRunnerScriptRequest,
              record: attempt?.script,
            },
          );
          controller.signal.throwIfAborted();
          item = updated;
          if (failed) {
            errorReason = 'script';
            throw new Error(t('Falha no script de pré-requisição.'));
          }
          if (skipped) {
            row.skipped = true;
            attempt?.skip();
            throw skippedRequest;
          }
          template = compileRequest(
            item,
            scripts.collection,
            variables,
            false,
            true,
            scripts.defaults,
          );
          if (native) {
            template = addConsoleMasks(
              template,
              item,
              scripts.collection,
              scripts.environment,
              variables,
              true,
            );
            template.console_masks!.values.push(
              ...[...changes.values()].filter((value): value is string => value !== null),
            );
          }
        }
        if (!template) throw new Error(step.preparation_error);
        const request = native ? template : resolveHttpRequest(template, variables);
        if (!native) checkBrowserRequest(request);
        const needsJson =
          step.tests.some((test) => test.type === 'json') || Object.keys(step.extract).length > 0;
        errorReason = 'transport';
        const hasPostScript = Boolean(
          scripts?.collection.scripts?.after?.trim() || item?.scripts?.after?.trim(),
        );
        const captureBody = needsJson || hasPostScript;
        if (hasPostScript && attempt)
          deferredTrace = postResponseTrace(attempt.trace, attempt.script);
        const response = native
          ? await invoke<HttpResponse>('send', {
              request,
              runnerStep: { index, variables, capture_body: captureBody, extract: step.extract },
              console: new Channel<ConsoleTrace>(deferredTrace?.trace ?? attempt?.trace),
            })
          : await browserSend(request, captureBody ? 16 * 1024 * 1024 : null);
        row.status = response.status;
        row.http_ms = response.duration_ms;
        const validation = performance.now();
        const json = needsJson ? responseJson(response) : undefined;
        step.tests.forEach((test) => {
          const failure = checkResponse(test, response, json);
          if (failure) addFailure(test.type, failure);
          else row.checks_passed++;
        });
        Object.entries(step.extract).forEach(([key, path]) => {
          if (!isJsonPointer(path) || json?.error) {
            addFailure(
              'extraction',
              !isJsonPointer(path) ? t('JSON Pointer inválido: {0}.', path) : json!.error!,
            );
            return;
          }
          const value = jsonPointer(json?.value, path);
          if (['string', 'number', 'boolean'].includes(typeof value)) {
            variables[key] = String(value);
            if (scripts) changes.set(key, String(value));
          } else addFailure('extraction', t('Extração exige um valor escalar em {0}.', path));
        });
        if (scripts && item && row.scriptResults) {
          const after = await runScripts(
            'after',
            scripts.collection,
            item,
            variables,
            changes,
            row.scriptResults,
            redact,
            response,
            {
              environmentName: scripts.environment.name,
              signal: controller.signal,
              send: sendRunnerScriptRequest,
              record: deferredTrace?.script ?? attempt?.script,
              protectWrite: deferredTrace?.protect,
            },
          );
          controller.signal.throwIfAborted();
          deferredTrace?.finish(!after.failed);
        }
        row.validation_ms = Math.round(performance.now() - validation);
      } catch (error) {
        deferredTrace?.finish(false);
        row.http_ms = Math.round(performance.now() - tick);
        if (controller.signal.aborted) {
          attempt?.failure(row.http_ms, 'cancelled');
          outcome = 'cancelled';
          break;
        }
        if (error !== skippedRequest)
          attempt?.failure(
            row.http_ms,
            errorReason === 'transport' ? 'transmission' : 'preparation',
          );
        if (error !== skippedRequest && errorReason !== 'script')
          addFailure(errorReason, redact(normalizeError(error).message));
      }
      for (const test of row.scriptResults ?? []) {
        if (test.passed) row.checks_passed++;
        else addFailure('script', test.error ? `${test.label} · ${test.error}` : test.label);
      }
      results.push(row);
      onProgress({ type: 'finished', index, row });
      if (collection.stop_on_failure && row.failures.length) {
        outcome = 'stopped_on_failure';
        break;
      }
    }
    return { results, outcome, duration_ms: Math.round(performance.now() - start) };
  } finally {
    controller = undefined;
    if (native) await invoke('reset_runner_cookies');
  }
}

export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return new Error(t('Execução cancelada.'));
    if (error.name === 'TimeoutError')
      return new Error(t('A requisição excedeu o timeout configurado.'));
    if (error.message === 'Failed to fetch')
      return new Error(
        t(
          'Não foi possível conectar. Confira a URL e se o servidor está ativo. No navegador, a API também precisa permitir CORS; no app desktop essa restrição não existe.',
        ),
      );
    return error;
  }
  return new Error(localizeNativeMessage(String(error)));
}
