import { expect, it, vi } from 'vitest';
import {
  clearRequestConsole,
  consoleAttemptHasError,
  useRequestConsole,
  type ConsoleTrace,
} from './request-console';
import { prepareCollection } from './collection-runner';
import { createWorkspace, newRequest } from './models';
import { runCollection } from './transport';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({
    status: 200,
    duration_ms: 1,
    headers: [],
    preview: '{}',
    truncated: false,
  })),
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke,
  Channel: class {
    constructor(readonly onmessage?: (trace: ConsoleTrace) => void) {}
  },
}));

it('agrupa scripts e tráfego HTTP por tentativa, mesmo para a mesma requisição', async () => {
  clearRequestConsole();
  const collection = createWorkspace().collections[0];
  const request = {
    ...newRequest(),
    url: 'https://example.test/profile',
    scripts: {
      before:
        'console.warn("Configuração escolhida"); pm.sendRequest("https://example.test/login", () => {});',
      after: 'console.info("Resposta processada", pm.response.code);',
    },
  };
  const requests = [request];
  const environment = { id: 'fixture', name: 'Fixture', color: '', variables: [] };
  invoke.mockImplementation(async (...args: unknown[]) => {
    const options = args[1] as
      | {
          runnerStep?: { index: number };
          console?: { onmessage: (trace: ConsoleTrace) => void };
        }
      | undefined;
    const status = options?.runnerStep?.index === 0 ? 401 : 200;
    const response = { status, duration_ms: 5, headers: [], preview: '', truncated: false };
    if (options?.runnerStep) {
      options.console?.onmessage({
        step: options.runnerStep.index + 1,
        duration_ms: response.duration_ms,
        request: null,
        response,
        redirects: [],
        failure: null,
      });
    }
    return response;
  });
  await runCollection(
    { ...prepareCollection(collection, environment, requests, false), iterations: 2 },
    () => {},
    [request.id],
    { collection, environment, requests },
  );

  const attempts = useRequestConsole();
  expect(attempts).toHaveLength(2);
  expect(attempts.map(({ requestId }) => requestId)).toEqual([request.id, request.id]);
  expect(
    attempts.map(({ events }) =>
      events.map((event) =>
        event.type === 'script'
          ? event.script.message
          : event.type === 'http'
            ? event.trace.response?.status
            : event.type,
      ),
    ),
  ).toEqual([
    ['Configuração escolhida', 'pm.sendRequest · GET · 200', 401, 'Resposta processada 401'],
    ['Configuração escolhida', 'pm.sendRequest · GET · 200', 200, 'Resposta processada 200'],
  ]);
  expect(attempts.filter(consoleAttemptHasError)).toEqual([attempts[0]]);
});
