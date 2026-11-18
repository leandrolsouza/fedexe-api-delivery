import { beforeEach, expect, it, vi } from 'vitest';
import { applyAppPreferences, saveAppPreferences } from './app-preferences';
import { createEmptyWorkspace, pair } from './models';

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
it('migrates appearance from the first workspace and shares it without changing workspace defaults or secrets', () => {
  const first = createEmptyWorkspace('First');
  first.settings.theme = 'dark';
  first.settings.defaultTimeoutMs = 5000;
  applyAppPreferences(first);
  const second = createEmptyWorkspace('Second');
  second.settings.defaultTimeoutMs = 15000;
  second.environments.push({
    id: 'private',
    name: 'Private',
    color: 'purple',
    variables: [{ ...pair('token', 'secret-value'), secret: true }],
  });
  const result = applyAppPreferences(second);
  expect(result.settings.theme).toBe('dark');
  expect(result.settings.workspaceName).toBe('Second');
  expect(result.settings.defaultTimeoutMs).toBe(15000);
  expect(result.environments).toBe(second.environments);
  expect([...storage.values()].join()).not.toContain('secret-value');
  result.settings.theme = 'light';
  saveAppPreferences(result.settings);
  expect(applyAppPreferences(first).settings.theme).toBe('light');
  expect(first.settings.defaultTimeoutMs).toBe(5000);
});
it('preserves existing workspaces when preferences are corrupt or storage is unavailable', () => {
  const workspace = createEmptyWorkspace('Existing');
  storage.set('fedexe.app-preferences', '{broken');
  expect(applyAppPreferences(workspace)).toBe(workspace);
  storage.set(
    'fedexe.app-preferences',
    JSON.stringify({ theme: 'bad', compact: true, wrap: true }),
  );
  expect(applyAppPreferences(workspace)).toBe(workspace);
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('unavailable');
    },
  });
  expect(applyAppPreferences(workspace)).toBe(workspace);
});
