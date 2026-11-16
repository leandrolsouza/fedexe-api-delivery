import { Channel, invoke } from '@tauri-apps/api/core';
import type { NativeCollection } from './models';

export type LoadOptions = {
  profile: 'constant' | 'ramp' | 'spike' | 'soak';
  vus: number;
  duration_seconds: number;
  base_vus: number;
  phase_seconds: number;
  think_ms: number;
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
};

export async function runLoad(
  collection: NativeCollection,
  options: LoadOptions,
  onProgress: (metrics: LoadMetrics) => void,
) {
  const progress = new Channel<LoadMetrics>(onProgress);
  try {
    return await invoke<LoadReport>('run_load', { collection, options, progress });
  } finally {
    progress.onmessage = () => {};
  }
}
