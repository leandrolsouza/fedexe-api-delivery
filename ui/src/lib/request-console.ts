import { useSyncExternalStore } from 'react';
import { originalWorkspaceId } from './local-workspaces';
import { redactValues } from './models';

type Headers = [string, string][];
export type ConsoleSource = 'editor' | 'runner';
export type ConsoleTrace = {
  step: number | null;
  duration_ms: number;
  request: {
    method: string;
    url: string;
    headers: Headers;
    body: { preview: string; truncated: boolean } | null;
  } | null;
  response: {
    status: number;
    headers: Headers;
    preview: string;
    truncated: boolean;
    hiddenByPostResponseScript?: boolean;
  } | null;
  redirects: { status: number; url: string; followed: boolean }[];
  failure:
    | 'preparation'
    | 'resolution'
    | 'connection'
    | 'timeout'
    | 'transmission'
    | 'redirect'
    | 'response'
    | 'validation'
    | 'cancelled'
    | null;
};

export function postResponseTrace(
  record: (trace: ConsoleTrace) => void,
  recordScript?: (label: string, event: Omit<ScriptMessage, 'label'>) => void,
) {
  const secrets = new Set<string>();
  const scripts: ScriptMessage[] = [];
  let pending: ConsoleTrace | undefined;
  let succeeded: boolean | undefined;

  function publish() {
    if (!pending || succeeded === undefined) return;
    const trace = { ...pending };
    pending = undefined;
    if (trace.response) {
      const response = (trace.response = { ...trace.response });
      if (!succeeded) {
        response.headers = [];
        response.preview = '';
        response.hiddenByPostResponseScript = true;
      } else if (secrets.size) {
        const previewSecrets = [...secrets].flatMap((secret) => [
          secret,
          JSON.stringify(secret).slice(1, -1),
          new URLSearchParams([['', secret]]).toString().slice(1),
        ]);
        response.preview = response.truncated ? '' : redactValues(response.preview, previewSecrets);
        const redactHeader = (field: string) =>
          // A native header clipped at 2 KiB may end with only part of a secret.
          new TextEncoder().encode(field).length >= 2045
            ? '[segredo]'
            : redactValues(field, previewSecrets);
        response.headers = response.headers.map(([name, value]) => [
          redactHeader(name),
          redactHeader(value),
        ]);
      }
    }
    secrets.clear();
    record(trace);
    for (const { label, ...event } of scripts.splice(0)) recordScript?.(label, event);
  }

  return {
    trace(trace: ConsoleTrace) {
      pending = trace;
      publish();
    },
    protect(value: string) {
      secrets.add(value);
    },
    script(label: string, event: Omit<ScriptMessage, 'label'>) {
      scripts.push({ label, ...event });
    },
    finish(success: boolean) {
      succeeded ??= success;
      publish();
    },
  };
}

const ATTEMPT_LIMIT = 100;
type ScriptMessage = { label: string; level: string; message: string };
type ConsoleEvent =
  | { type: 'http'; trace: ConsoleTrace }
  | { type: 'script'; script: ScriptMessage }
  | { type: 'skipped' };

export type ConsoleAttempt = {
  id: number;
  date: string;
  source: ConsoleSource;
  requestId?: string;
  step: number | null;
  events: ConsoleEvent[];
};
const listeners = new Set<() => void>();
const emptyAttempts: ConsoleAttempt[] = [];
const attemptsByWorkspace = new Map<string, ConsoleAttempt[]>();
let workspaceId = originalWorkspaceId;
let nextId = 0;

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function currentAttempts() {
  return attemptsByWorkspace.get(workspaceId) ?? emptyAttempts;
}

export function useRequestConsole() {
  return useSyncExternalStore(subscribe, currentAttempts);
}

export function selectRequestConsole(id: string) {
  workspaceId = id;
  notify();
}

export function clearRequestConsole() {
  attemptsByWorkspace.delete(workspaceId);
  notify();
}

export function consoleAttemptFactory(source: ConsoleSource) {
  const owner = workspaceId;
  return (requestId?: string, step: number | null = null) => {
    const attempt: ConsoleAttempt = {
      id: nextId++,
      date: new Date().toISOString(),
      source,
      requestId,
      step,
      events: [],
    };
    let published = false;
    let hasTrace = false;
    function record(event: ConsoleEvent) {
      const attempts = attemptsByWorkspace.get(owner) ?? emptyAttempts;
      if (published) {
        const index = attempts.findIndex(({ id }) => id === attempt.id);
        if (index === -1) return;
        const updated = attempts.slice();
        updated[index] = { ...attempts[index], events: [...attempts[index].events, event] };
        attemptsByWorkspace.set(owner, updated);
      } else {
        attemptsByWorkspace.set(owner, [
          ...attempts.slice(1 - ATTEMPT_LIMIT),
          { ...attempt, events: [event] },
        ]);
        published = true;
      }
      if (owner === workspaceId) notify();
    }
    return {
      trace(trace: ConsoleTrace) {
        hasTrace = true;
        record({ type: 'http', trace });
      },
      script(label: string, event: Omit<ScriptMessage, 'label'>) {
        record({ type: 'script', script: { label, ...event } });
      },
      skip() {
        record({ type: 'skipped' });
      },
      failure(duration: number, failure: NonNullable<ConsoleTrace['failure']>) {
        if (hasTrace) return;
        record({
          type: 'http',
          trace: {
            step,
            duration_ms: duration,
            failure,
            request: null,
            response: null,
            redirects: [],
          },
        });
      },
    };
  };
}

export function consoleAttemptHasError(attempt: ConsoleAttempt) {
  return attempt.events.some((event) => {
    if (event.type === 'script') return event.script.level === 'error';
    if (event.type === 'http')
      return Boolean(event.trace.failure) || (event.trace.response?.status ?? 0) >= 400;
    return false;
  });
}
