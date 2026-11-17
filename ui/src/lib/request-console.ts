import { useSyncExternalStore } from 'react';

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
let currentAttempts: ConsoleAttempt[] = emptyAttempts;
let nextId = 0;

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRequestConsole() {
  return useSyncExternalStore(subscribe, () => currentAttempts);
}

export function clearRequestConsole() {
  currentAttempts = emptyAttempts;
  notify();
}

export function consoleAttemptFactory(source: ConsoleSource) {
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
      const attempts = currentAttempts;
      if (published) {
        const index = attempts.findIndex(({ id }) => id === attempt.id);
        if (index === -1) return;
        const updated = attempts.slice();
        updated[index] = { ...attempts[index], events: [...attempts[index].events, event] };
        currentAttempts = updated;
      } else {
        currentAttempts = [...attempts.slice(1 - ATTEMPT_LIMIT), { ...attempt, events: [event] }];
        published = true;
      }
      notify();
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
