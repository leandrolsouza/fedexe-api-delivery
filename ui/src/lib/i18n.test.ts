import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('defaults to English and restores a locally stored Portuguese preference', async () => {
  const preferences = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, value),
  });
  const english = await import('./i18n');
  expect(english.t('Configurações')).toBe('Settings');
  expect(english.formatNumber(1234.5)).toBe('1,234.5');

  english.setLocale('pt-BR');
  vi.resetModules();
  const portuguese = await import('./i18n');
  expect(portuguese.t('Configurações')).toBe('Configurações');
  expect(portuguese.formatNumber(1234.5)).toBe('1.234,5');
});

it('localizes native validation messages and preserves their arguments', async () => {
  const { localizeNativeMessage } = await import('./native-messages');
  expect(localizeNativeMessage('JSON Pointer inválido: /usuários/{0}.')).toBe(
    'Invalid JSON Pointer: /usuários/{0}.',
  );
  expect(localizeNativeMessage('Status esperado 200, recebido 404.')).toBe(
    'Expected status 200, received 404.',
  );
  expect(localizeNativeMessage('Unrecognized diagnostic')).toBe('Unrecognized diagnostic');
});
