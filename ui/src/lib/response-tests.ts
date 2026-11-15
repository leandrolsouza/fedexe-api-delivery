import { t } from './i18n';
import type { HttpResponse, Test } from './models';
import { jsonEqual } from './utils';

export function isJsonPointer(pointer: string) {
  return pointer === '' || (pointer.startsWith('/') && !/~(?![01])/.test(pointer));
}

export function jsonPointer(value: unknown, pointer: string): unknown {
  if (!isJsonPointer(pointer)) return undefined;
  if (pointer === '') return value;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object') return undefined;
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) return undefined;
    if (!Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function responseJson(response: HttpResponse) {
  if (response.truncated) return { error: t('O corpo excede o limite de validação JSON.') };
  try {
    return { value: JSON.parse(response.preview) as unknown };
  } catch {
    return { error: t('A resposta não contém JSON válido.') };
  }
}

export function checkResponse(
  test: Test,
  response: HttpResponse,
  json?: ReturnType<typeof responseJson>,
): string | undefined {
  if (test.type === 'status') {
    if (response.status !== test.equals)
      return t('Status esperado {0}, recebido {1}.', test.equals, response.status);
    return;
  }
  if (test.type === 'header') {
    const name = test.name.trim();
    const values = response.headers.filter(([key]) => key.toLowerCase() === name.toLowerCase());
    if (!values.length) return t('Header ausente: {0}', name);
    if (test.equals !== undefined && !values.some(([, value]) => value === test.equals))
      return t('Valor inesperado no header {0}.', name);
    return;
  }
  if (!isJsonPointer(test.pointer)) return t('JSON Pointer inválido: {0}.', test.pointer);
  if (json?.error) return json.error;
  if (!jsonEqual(jsonPointer(json?.value, test.pointer), test.equals))
    return t('Valor inesperado em {0}.', test.pointer || '(raiz)');
}
