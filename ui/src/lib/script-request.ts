import { t } from './i18n';
import { resolveHttpRequest, type HttpRequest } from './models';

type Field = { key: string; value: string; disabled?: boolean };

function fields(value: unknown): [string, string][] {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((field: Field) => {
      if (typeof field?.key !== 'string' || typeof field.value !== 'string')
        throw new Error(t('Cabeçalho ou campo inválido em pm.sendRequest.'));
      return field.disabled ? [] : [[field.key, field.value]];
    });
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.every((entry): entry is [string, string] => typeof entry[1] === 'string'))
      return entries;
  }
  throw new Error(t('Cabeçalho ou campo inválido em pm.sendRequest.'));
}

export function scriptHttpRequest(value: unknown, variables: Record<string, string>): HttpRequest {
  const config = typeof value === 'string' ? { url: value } : value;
  if (!config || typeof config !== 'object' || !('url' in config) || typeof config.url !== 'string')
    throw new Error(t('Informe uma URL em pm.sendRequest.'));

  const method = 'method' in config ? config.method : 'GET';
  if (
    typeof method !== 'string' ||
    !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
  )
    throw new Error(t('Método HTTP sem suporte em pm.sendRequest.'));

  const headers = fields('header' in config ? config.header : undefined);
  const body = 'body' in config ? config.body : undefined;
  const request: HttpRequest = {
    url: config.url,
    method: method.toUpperCase(),
    headers,
    body: null,
  };
  if (typeof body === 'string') request.body = body;
  else if (body && typeof body === 'object') {
    if ('mode' in body && body.mode === 'raw' && 'raw' in body && typeof body.raw === 'string')
      request.body = body.raw;
    else if ('mode' in body && body.mode === 'urlencoded' && 'urlencoded' in body) {
      request.form = fields(body.urlencoded);
      if (!headers.some(([key]) => key.toLowerCase() === 'content-type'))
        headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
    } else throw new Error(t('Modo de corpo sem suporte em pm.sendRequest.'));
  } else if (body != null) throw new Error(t('Modo de corpo sem suporte em pm.sendRequest.'));

  return resolveHttpRequest(request, variables);
}
