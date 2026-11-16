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

const ENTRY_LIMIT = 100;
type ConsoleEntry = ConsoleTrace & {
  id: number;
  date: string;
  source: ConsoleSource;
  requestId?: string;
};
const listeners = new Set<() => void>();
let entries: ConsoleEntry[] = [];
let nextId = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRequestConsole() {
  return useSyncExternalStore(subscribe, () => entries);
}

export function clearRequestConsole() {
  entries = [];
  listeners.forEach((listener) => listener());
}

export function recordRequestTrace(source: ConsoleSource, trace: ConsoleTrace, requestId?: string) {
  entries = [
    ...entries.slice(1 - ENTRY_LIMIT),
    { ...trace, id: nextId++, source, requestId, date: new Date().toISOString() },
  ];
  listeners.forEach((listener) => listener());
}

export function recordEditorPreparationFailure(
  duration: number,
  resolution: boolean,
  requestId: string,
) {
  recordRequestTrace(
    'editor',
    {
      step: null,
      duration_ms: duration,
      failure: resolution ? 'resolution' : 'preparation',
      request: null,
      response: null,
      redirects: [],
    },
    requestId,
  );
}
