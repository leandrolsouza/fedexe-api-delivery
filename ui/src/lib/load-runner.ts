import { Channel, invoke } from '@tauri-apps/api/core';
import type { NativeCollection } from './models';
import type { Collection, Environment, RequestItem } from './models';
import { redactSecrets } from './models';
import { runScripts, type ScriptResult } from './scripts';
import { sendScriptRequest } from './transport';
import { t } from './i18n';

export type LoadOptions = {
  profile: 'constant' | 'ramp' | 'spike' | 'soak';
  vus: number;
  duration_seconds: number;
  base_vus: number;
  phase_seconds: number;
  think_ms: number;
  skip_scripts?: boolean;
  collection_setup?: boolean;
  max_p99_ms?: number;
  max_error_percent?: number;
};

export type LoadMetrics = {
  duration_ms: number;
  requests: number;
  rps: number;
  mean_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  error_percent: number | null;
  http_errors: number;
  transport_errors: number;
  timeouts: number;
  validation_failures: number;
};

export type LoadReport = {
  schema_version: 1;
  exit_code: 0 | 1 | 2;
  outcome: 'completed' | 'cancelled' | 'preparation_error';
  options: LoadOptions;
  metrics: LoadMetrics;
  p99_passed: boolean | null;
  error_rate_passed: boolean | null;
  thresholds: { p99_ms: LoadThreshold; error_percent: LoadThreshold };
  requests_by_step: {
    step: number;
    requests: number;
    errors: number;
    error_percent: number | null;
    http_errors_by_status: Record<string, number>;
    transport_errors: number;
    validation_failures: number;
  }[];
  preparation_failure?: { step: number; missing_variable?: string };
  timeline: LoadInterval[];
};

export type LoadInterval = {
  start_ms: number;
  end_ms: number;
  requests: number;
  errors: number;
  rps: number;
  p95_ms: number | null;
  p99_ms: number | null;
  error_percent: number | null;
  first_error_ms: number | null;
};

type LoadProgress = LoadMetrics & { interval?: LoadInterval };

type LoadThreshold = { measured: number | null; limit: number | null; passed: boolean | null };

export async function prepareLoadVariables(
  collection: Collection,
  environment: Environment,
  first: RequestItem,
  variables: Record<string, string>,
  signal: AbortSignal,
) {
  const request = { ...first, scripts: undefined };
  const results: ScriptResult[] = [];
  const { item, failed, skipped } = await runScripts(
    'before',
    collection,
    request,
    variables,
    new Map(),
    results,
    (message) => redactSecrets(message, environment),
    undefined,
    {
      environmentName: environment.name,
      signal,
      send: (request, signal) => sendScriptRequest({ ...request, ignore_cookies: true }, signal),
    },
  );
  if (failed || skipped || item !== request || results.some((result) => !result.passed)) {
    throw new Error(
      t(
        'O pré-script da coleção falhou ou tentou alterar a requisição. A preparação de carga aceita variáveis.',
      ),
    );
  }
}

export async function runLoad(
  collection: NativeCollection,
  options: LoadOptions,
  onProgress: (metrics: LoadProgress) => void,
) {
  const progress = new Channel<LoadProgress>(onProgress);
  try {
    return await invoke<LoadReport>('run_load', { collection, options, progress });
  } finally {
    progress.onmessage = () => {};
  }
}
