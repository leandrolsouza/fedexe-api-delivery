import type { QuickJSHandle } from 'quickjs-emscripten-core';
import type { HttpRequest, HttpResponse, RequestItem, Collection } from './models';
import { redactValues } from './models';
import { t } from './i18n';
import { uid } from './utils';
import { scriptHttpRequest } from './script-request';

export type Scripts = { before?: string; after?: string };
export type ScriptResult = { label: string; passed: boolean; error?: string; scriptError?: true };
type Phase = keyof Scripts;
type ScriptEvent = { level: string; message: string };
type ScriptContext = {
  environmentName?: string;
  protectWrite?: (value: string) => void;
  record?: (label: string, event: ScriptEvent) => void;
  signal?: AbortSignal;
  send?: (request: HttpRequest, signal?: AbortSignal) => Promise<HttpResponse>;
};
const maxScriptRequests = 10;
let engine: Promise<import('quickjs-emscripten-core').QuickJSWASMModule> | undefined;

function loadEngine() {
  engine ??= Promise.all([
    import('quickjs-emscripten-core'),
    import('@jitl/quickjs-wasmfile-release-sync'),
  ])
    .then(([core, variant]) => core.newQuickJSWASMModuleFromVariant(variant.default))
    .catch((error) => {
      engine = undefined;
      throw error;
    });
  return engine;
}

export function hasScripts(scripts?: Scripts) {
  return Boolean(scripts?.before?.trim() || scripts?.after?.trim());
}

type HeaderEdit = { key: string; value?: string };
type ScriptOutput = {
  tests: ScriptResult[];
  writes: [string, string | null][];
  headers: HeaderEdit[];
  error?: string;
  skipped?: true;
};

const bootstrap = `
  const tests = [], writes = [], headers = [];
  const { variables, request, response } = input;
  const stringify = JSON.stringify;
  const skip = {};
  function runSync(callback) {
    try {
      const result = callback();
      if (typeof result?.then === 'function') throw new Error(input.syncOnly);
    } catch (error) {
      if (error !== skip) throw error;
    }
  }
  const variableApi = Object.freeze({
    get: (key) => Object.hasOwn(variables, key) ? variables[key] : undefined,
    has: (key) => Object.hasOwn(variables, key),
    replaceIn(value) {
      return String(value).replace(/[{][{]([^{}]+)[}][}]/g, (match, name) => {
        const key = name.trim();
        return Object.hasOwn(variables, key) ? variables[key] : match;
      });
    },
    set(key, value) {
      key = String(key);
      value = String(value);
      Object.defineProperty(variables, key, { value, writable: true, configurable: true });
      writes.push([key, value]);
      protect(value);
    },
    unset(key) {
      key = String(key);
      delete variables[key];
      writes.push([key, null]);
    },
  });
  const headerGet = (rows, key) =>
    rows.find(([name]) => name.toLowerCase() === String(key).toLowerCase())?.[1];
  function editHeader(key, value) {
    if (response) throw new Error(input.readOnly);
    key = String(key).trim();
    if (!key) throw new Error(input.emptyHeader);
    const index = request.headers.findIndex(([name]) => name.toLowerCase() === key.toLowerCase());
    request.headers = request.headers.filter(([name]) => name.toLowerCase() !== key.toLowerCase());
    if (value !== undefined) request.headers.splice(index < 0 ? request.headers.length : index, 0, [key, value]);
    headers.push({ key, value });
    if (value !== undefined) protect(value);
  }
  function describe(error) {
    return String(error?.message ?? error).slice(0, 4000);
  }
  function deepEqual(left, right, seen = new WeakMap()) {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left) && left.length !== right.length) return false;
    if (!Array.isArray(left) && [left, right].some((value) => {
      const prototype = Object.getPrototypeOf(value);
      return prototype !== Object.prototype && prototype !== null;
    })) return false;
    if (seen.has(left)) return seen.get(left) === right;
    seen.set(left, right);
    const keys = Object.keys(left);
    const equal = keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key], seen));
    seen.delete(left);
    return equal;
  }
  function expect(actual, negated = false) {
    function assert(condition, message = input.assertionFailed) {
      if (Boolean(condition) === negated) throw new Error(message);
    }
    const kind = actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual;
    const length = actual?.length;
    const assertion = {
      get not() { return expect(actual, !negated); },
      equal(expected) { assert(actual === expected, input.expectedEqual); return assertion; },
      eql(expected) { assert(deepEqual(actual, expected), input.expectedEqual); return assertion; },
      property(key, ...expected) {
        const exists = actual != null && key in Object(actual);
        assert(exists && (!expected.length || actual[key] === expected[0]));
        return expect(exists ? actual[key] : undefined);
      },
      include(expected) {
        if (typeof actual === 'string') assert(typeof expected === 'string' && actual.includes(expected));
        else if (Array.isArray(actual)) assert(actual.includes(expected));
        else assert(kind === 'object' && expected && typeof expected === 'object' &&
          Object.keys(expected).every((key) => key in actual && actual[key] === expected[key]));
        return assertion;
      },
      a(expected) { assert(kind === String(expected).toLowerCase()); return assertion; },
      an(expected) { return assertion.a(expected); },
      above(expected) { assert(typeof actual === 'number' && actual > expected); return assertion; },
      get empty() {
        assert((kind === 'array' || kind === 'string') ? length === 0 :
          kind === 'object' && Object.keys(actual).length === 0);
        return assertion;
      },
      get null() { assert(actual === null); return assertion; },
      get undefined() { assert(actual === undefined); return assertion; },
      lengthOf(expected) { assert(typeof length === 'number' && length === expected); return assertion; },
    };
    assertion.lengthOf.above = (expected) => {
      assert(typeof length === 'number' && length > expected);
      return assertion;
    };
    for (const key of ['to', 'be', 'have', 'and', 'that']) assertion[key] = assertion;
    return assertion;
  }
  function responseApi(value) {
    return Object.freeze({
      code: value.status,
      responseTime: value.duration_ms,
      headers: Object.freeze({ get: (key) => headerGet(value.headers, key) }),
      text: () => value.preview,
      json() {
        if (value.truncated) throw new Error(input.truncated);
        return JSON.parse(value.preview);
      },
      to: { have: { status(expected) { pm.expect(value.status).to.equal(expected); } } },
    });
  }
  const pm = Object.freeze({
    variables: variableApi,
    environment: Object.freeze({ ...variableApi, name: input.environmentName }),
    collectionVariables: variableApi,
    globals: Object.freeze({ get: () => undefined, has: () => false }),
    execution: Object.freeze({
      skipRequest() {
        if (response) throw new Error(input.skipBeforeOnly);
        skipExecution();
        throw skip;
      },
    }),
    request: Object.freeze({
      method: request.method,
      url: request.url,
      headers: Object.freeze({
        get: (key) => headerGet(request.headers, key),
        upsert: ({ key, value }) => editHeader(key, String(value)),
        remove: (key) => editHeader(key),
      }),
    }),
    response: response && responseApi(response),
    sendRequest(config, callback) {
      if (typeof callback !== 'function') throw new Error(input.callbackRequired);
      queueRequest(stringify({ config, variables }), (message, payload) => {
        runSync(() => callback(message ? new Error(message) : null, payload && responseApi(JSON.parse(payload))));
      });
    },
    test(name, callback) {
      const label = String(name).slice(0, 500);
      if (tests.length >= 1000) throw new Error(input.tooManyTests);
      try {
        const result = callback();
        if (typeof result?.then === 'function') throw new Error(input.syncOnly);
        tests.push({ label, passed: true });
      } catch (error) {
        if (error === skip) throw error;
        tests.push({ label, passed: false, error: describe(error) });
      }
    },
    expect(actual) { return expect(actual); },
  });
`;

export async function executeScript(
  source: string,
  item: RequestItem,
  variables: Record<string, string>,
  response?: HttpResponse,
  context: ScriptContext = {},
  diagnostics?: { events: ScriptEvent[]; values: Set<string> },
): Promise<ScriptOutput> {
  const input = {
    variables,
    environmentName: context.environmentName,
    request: {
      method: item.method,
      url: item.url,
      headers: item.headers.filter(({ enabled }) => enabled).map(({ key, value }) => [key, value]),
    },
    response,
    readOnly: t('Os cabeçalhos só podem ser alterados antes do envio.'),
    emptyHeader: t('Informe o nome do cabeçalho.'),
    truncated: t('O corpo excede o limite de validação JSON.'),
    syncOnly: t('Os scripts e testes devem ser síncronos.'),
    callbackRequired: t('Passe um callback síncrono para pm.sendRequest.'),
    skipBeforeOnly: t('pm.execution.skipRequest só está disponível antes do envio.'),
    tooManyTests: t('Limite de 1.000 testes por script atingido.'),
    expectedEqual: t('O valor recebido é diferente do esperado.'),
    assertionFailed: t('O valor recebido não atende à asserção.'),
  };
  const vm = (await loadEngine()).newContext();
  let deadline = performance.now() + 250;
  let timedOut = false;
  let skipped = false;
  const pending: { payload: string; callback: QuickJSHandle }[] = [];
  vm.runtime.setMemoryLimit(96 * 1024 * 1024);
  vm.runtime.setMaxStackSize(512 * 1024);
  vm.runtime.setInterruptHandler(() => (timedOut = performance.now() > deadline));
  try {
    using decodeBase64 = vm.newFunction('atob', (value) => vm.newString(atob(vm.getString(value))));
    vm.setProp(vm.global, 'atob', decodeBase64);
    using protect = vm.newFunction('protect', (value) => {
      diagnostics?.values.add(vm.getString(value));
    });
    using console = vm.newObject();
    using formatLog = vm.unwrapResult(
      vm.evalCode(`
      (write => {
        if (!write) return () => {};
        const toString = String;
        const isError = value => value instanceof Error;
        return (...args) => {
          const message = args.map(value => {
            if (value === null) return 'null';
            if (isError(value)) return toString(value);
            return typeof value === 'object' ? '[object]' : toString(value);
          }).join(' ');
          if (message.length <= 16000) write(message);
        };
      })
    `),
    );
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      using write = vm.newFunction(level, (message) => {
        if (diagnostics && diagnostics.events.length < 50) {
          diagnostics.events.push({ level, message: vm.getString(message) });
        }
      });
      using method = vm.unwrapResult(
        vm.callFunction(formatLog, vm.undefined, diagnostics ? write : vm.undefined),
      );
      vm.setProp(console, level, method);
    }
    vm.setProp(vm.global, 'console', console);
    using queueRequest = vm.newFunction('sendRequest', (payload, callback) => {
      if (pending.length >= maxScriptRequests)
        throw new Error(
          t('Limite de {0} chamadas a pm.sendRequest por script atingido.', maxScriptRequests),
        );
      const json = vm.getString(payload);
      if (json.length > 1024 * 1024)
        throw new Error(t('A configuração de pm.sendRequest é grande demais.'));
      pending.push({ payload: json, callback: callback.dup() });
    });
    using skipExecution = vm.newFunction('skipRequest', () => {
      skipped = true;
    });
    // Compile the source separately so it cannot access the bookkeeping in the bootstrap closure.
    const script = vm.unwrapResult(
      vm.evalCode(`(function (pm) { 'use strict';\n${source}\n})`, 'script.js'),
    );
    try {
      const build = vm.unwrapResult(
        vm.evalCode(
          `(function (inputJson, script, queueRequest, skipExecution, protect) {
          const input = JSON.parse(inputJson);
          ${bootstrap}
          runSync(() => script(pm));
          return () => stringify({ tests, writes, headers });
        })`,
          'fedexe.js',
        ),
      );
      try {
        using data = vm.newString(JSON.stringify(input));
        using finish = vm.unwrapResult(
          vm.callFunction(build, vm.undefined, data, script, queueRequest, skipExecution, protect),
        );
        for (const { payload, callback } of pending) {
          if (skipped) break;
          context.signal?.throwIfAborted();
          let message = '';
          let result: HttpResponse | undefined;
          let method: string | undefined;
          try {
            const { config, variables: scriptVariables } = JSON.parse(payload);
            const request = scriptHttpRequest(config, scriptVariables);
            method = request.method;
            const started = performance.now();
            try {
              if (!context.send) throw new Error();
              result = await context.send(request, context.signal);
            } catch {
              message = t('Não foi possível enviar a requisição de pm.sendRequest.');
            } finally {
              deadline += performance.now() - started;
            }
          } catch (error) {
            message =
              error instanceof Error
                ? error.message
                : t('Configuração inválida em pm.sendRequest.');
          }
          context.signal?.throwIfAborted();
          diagnostics?.events.push({
            level: result && result.status < 400 ? 'info' : 'error',
            message: ['pm.sendRequest', method, result?.status ?? message]
              .filter(Boolean)
              .join(' · '),
          });
          using failure = vm.newString(message);
          using body = result ? vm.newString(JSON.stringify(result)) : undefined;
          vm.unwrapResult(
            vm.callFunction(callback, vm.undefined, failure, body ?? vm.undefined),
          ).dispose();
        }
        using output = vm.unwrapResult(vm.callFunction(finish, vm.undefined));
        if (timedOut) throw new Error();
        const parsed = JSON.parse(vm.getString(output)) as ScriptOutput;
        if (
          !Array.isArray(parsed.tests) ||
          !parsed.tests.every(
            (test) =>
              typeof test.label === 'string' &&
              typeof test.passed === 'boolean' &&
              (test.error === undefined || typeof test.error === 'string'),
          ) ||
          !Array.isArray(parsed.writes) ||
          !parsed.writes.every(
            (row) =>
              Array.isArray(row) &&
              typeof row[0] === 'string' &&
              (row[1] === null || typeof row[1] === 'string'),
          ) ||
          !Array.isArray(parsed.headers) ||
          !parsed.headers.every(
            ({ key, value }) =>
              typeof key === 'string' && (value === undefined || typeof value === 'string'),
          ) ||
          (parsed.error !== undefined && typeof parsed.error !== 'string')
        )
          throw new Error(t('O script retornou dados inválidos.'));
        return skipped ? { ...parsed, skipped: true } : parsed;
      } finally {
        build.dispose();
      }
    } finally {
      script.dispose();
    }
  } catch (error) {
    return {
      tests: [],
      writes: [],
      headers: [],
      error: timedOut
        ? t('O script excedeu o limite de tempo.')
        : (error instanceof Error ? error.message : String(error)).slice(0, 4000),
    };
  } finally {
    for (const { callback } of pending) callback.dispose();
    vm.dispose();
  }
}

export async function runScripts(
  phase: Phase,
  collection: Collection,
  item: RequestItem,
  variables: Record<string, string>,
  changes: Map<string, string | null>,
  results: ScriptResult[],
  redact: (message: string) => string,
  response?: HttpResponse,
  context: ScriptContext = {},
): Promise<{ item: RequestItem; failed: boolean; skipped?: true }> {
  let failed = false;
  for (const [scope, source] of [
    [t('Coleção'), collection.scripts?.[phase]],
    [t('Requisição'), item.scripts?.[phase]],
  ] as const) {
    context.signal?.throwIfAborted();
    if (!source?.trim()) continue;
    const label = `${scope} · ${t(phase === 'before' ? 'Pré-requisição' : 'Pós-resposta')}`;
    const diagnostics = context.record
      ? { events: [] as ScriptEvent[], values: new Set<string>() }
      : undefined;
    const output = await executeScript(
      source,
      item,
      variables,
      response,
      context,
      diagnostics,
    ).catch(() => ({
      tests: [],
      writes: [],
      headers: [],
      error: t('Não foi possível iniciar o JavaScript.'),
      skipped: undefined,
    }));
    if (diagnostics && context.record) {
      const headers = item.headers
        .filter(
          ({ enabled, key, secret }) =>
            enabled &&
            (secret || /^(authorization|proxy-authorization|cookie|x-api-key)$/i.test(key.trim())),
        )
        .flatMap(({ value }) => [value, value.replace(/^(Bearer|Basic)\s+/i, '')]);
      const values = [...diagnostics.values, ...Object.values(variables), ...headers];
      for (const event of diagnostics.events) {
        context.record(label, {
          ...event,
          message: redactValues(redact(event.message), values).slice(0, 4000),
        });
      }
      if (output.error !== undefined && !context.signal?.aborted) {
        context.record(label, {
          level: 'error',
          message: redactValues(redact(output.error), values),
        });
      }
    }
    context.signal?.throwIfAborted();
    const protectedValues = [...changes.values(), ...output.writes.map(([, value]) => value)];
    const clean = (message: string) => redactValues(redact(message), protectedValues);
    for (const test of output.tests) {
      results.push({
        ...test,
        label: `${label} · ${clean(test.label)}`,
        error: test.error ? clean(test.error) : undefined,
      });
    }
    if (output.error !== undefined) {
      results.push({ label, passed: false, error: clean(output.error), scriptError: true });
      failed = true;
      if (phase === 'before') break;
      continue;
    }
    for (const [key, value] of output.writes) {
      if (value !== null) context.protectWrite?.(value);
      changes.set(key, value);
      if (value === null) delete variables[key];
      else variables[key] = value;
    }
    if (output.skipped) return { item, failed, skipped: true };
    if (phase === 'before' && output.headers.length) {
      let headers = item.headers;
      for (const { key, value } of output.headers) {
        headers = headers.filter((row) => row.key.trim().toLowerCase() !== key.toLowerCase());
        if (value !== undefined)
          headers.push({ id: uid(), key, value, enabled: true, secret: true });
      }
      item = { ...item, headers };
    }
  }
  return { item, failed };
}
