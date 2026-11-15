import { localizeNativeMessage } from './native-messages';
import { t } from './i18n';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { checkResponse, isJsonPointer, jsonPointer, responseJson } from './response-tests';
import {
  resolveHttpRequest,
  DEFAULT_TIMEOUT_MS,
  type HttpRequest,
  type HttpResponse,
  type NativeCollection,
  type RunResult,
  type RunRow,
} from './models';

let controller: AbortController | undefined;
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

async function browserSend(
  request: HttpRequest,
  limit: number | null = 256 * 1024,
): Promise<HttpResponse> {
  if (request.multipart !== undefined || request.binary_file !== undefined)
    throw new Error(t('Corpos multipart e binários estão disponíveis no app desktop.'));
  const start = performance.now();
  if (request.redirect_policy === 'same_origin')
    throw new Error(t('Para seguir redirecionamentos da mesma origem, execute no app desktop.'));
  const timeout = AbortSignal.timeout(request.timeout_ms ?? DEFAULT_TIMEOUT_MS);
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    signal: controller ? AbortSignal.any([controller.signal, timeout]) : timeout,
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

export async function send(request: HttpRequest) {
  controller = new AbortController();
  try {
    return native ? await invoke<HttpResponse>('send', { request }) : await browserSend(request);
  } catch (error) {
    throw normalizeError(error);
  } finally {
    controller = undefined;
  }
}
export async function cancel() {
  if (native) await invoke('cancel');
  else controller?.abort();
}

type RunProgress =
  { type: 'started'; index: number } | { type: 'finished'; index: number; row: RunRow };

export async function runCollection(
  collection: NativeCollection,
  onProgress: (event: RunProgress) => void,
): Promise<RunResult> {
  if (native) {
    const localizeRow = (row: RunRow) => ({
      ...row,
      failures: row.failures.map(localizeNativeMessage),
    });
    const progress = new Channel<RunProgress>((event) =>
      onProgress(event.type === 'finished' ? { ...event, row: localizeRow(event.row) } : event),
    );
    try {
      const result = await invoke<RunResult>('run', { collection, progress });
      return { ...result, results: result.results.map(localizeRow) };
    } finally {
      progress.onmessage = () => {};
    }
  }
  controller = new AbortController();
  const start = performance.now();
  const results: RunRow[] = [];
  let outcome: RunResult['outcome'] = 'completed';
  const variables: Record<string, string> = Object.assign(
    Object.create(null),
    collection.variables,
  );
  try {
    for (const [index, step] of collection.requests.entries()) {
      if (controller.signal.aborted) {
        outcome = 'cancelled';
        break;
      }
      onProgress({ type: 'started', index });
      const row: RunRow = {
        name: step.name,
        status: null,
        http_ms: 0,
        validation_ms: 0,
        checks_passed: 0,
        failures: [],
      };
      const tick = performance.now();
      try {
        if (!step.request) throw new Error(step.preparation_error);
        const request = resolveHttpRequest(step.request, variables);
        const needsJson =
          step.tests.some((test) => test.type === 'json') || Object.keys(step.extract).length > 0;
        const response = await browserSend(request, needsJson ? 16 * 1024 * 1024 : null);
        row.status = response.status;
        row.http_ms = response.duration_ms;
        const validation = performance.now();
        const json = needsJson ? responseJson(response) : undefined;
        step.tests.forEach((test) => {
          const failure = checkResponse(test, response, json);
          if (failure) row.failures.push(failure);
          else row.checks_passed++;
        });
        Object.entries(step.extract).forEach(([key, path]) => {
          if (!isJsonPointer(path) || json?.error) {
            row.failures.push(
              !isJsonPointer(path) ? t('JSON Pointer inválido: {0}.', path) : json!.error!,
            );
            return;
          }
          const value = jsonPointer(json?.value, path);
          if (['string', 'number', 'boolean'].includes(typeof value))
            variables[key] = String(value);
          else row.failures.push(t('Extração exige um valor escalar em {0}.', path));
        });
        row.validation_ms = Math.round(performance.now() - validation);
      } catch (error) {
        if (controller.signal.aborted) {
          outcome = 'cancelled';
          break;
        }
        row.http_ms = Math.round(performance.now() - tick);
        row.failures.push(normalizeError(error).message);
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
