import { t } from './i18n';
import { newRequest, pair, syncUrl, type Method, type MultipartRow } from './models';

export function isCurl(text: string) {
  return /^curl(?:\.exe)?(?:\s|$)/i.test(text.trim());
}

function argumentsFrom(text: string) {
  const tokens = /"(?:[^"\\]|\\.)*"|'[^']*'|\\[^\r\n]|[^\s"'\\]+/g;
  const args: string[] = [];
  const input = text.trim().replace(/\\\r?\n/g, '');
  let end = 0;
  for (const match of input.matchAll(tokens)) {
    const gap = input.slice(end, match.index);
    if (gap.trim()) throw new Error(t('Aspas ou escape inválido no comando cURL.'));
    const token = match[0];
    const value = token.startsWith("'")
      ? token.slice(1, -1)
      : token.startsWith('"')
        ? token.slice(1, -1).replace(/\\(["\\$`])/g, '$1')
        : token.startsWith('\\')
          ? token.slice(1)
          : token;
    if (gap || !args.length) args.push(value);
    else args[args.length - 1] += value;
    end = match.index + token.length;
  }
  if (input.slice(end).trim()) throw new Error(t('Aspas ou escape inválido no comando cURL.'));
  return args;
}

export function importCurl(text: string) {
  const [command, ...args] = argumentsFrom(text);
  if (!isCurl(command ?? '')) throw new Error(t('Cole um comando cURL.'));
  const request = { ...newRequest(), name: t('Requisição cURL'), url: '', headers: [], tests: [] };
  const headers: ReturnType<typeof pair>[] = [];
  const issues: string[] = [];
  const data: string[] = [];
  const multipart: MultipartRow[] = [];
  let method = '';
  let get = false;
  let binary = false;
  let json = false;
  const options = new Map([
    ['-X', '--request'],
    ['-H', '--header'],
    ['-d', '--data'],
    ['-u', '--user'],
    ['-I', '--head'],
    ['-G', '--get'],
    ['-L', '--location'],
    ['-m', '--max-time'],
  ]);
  const setUrl = (value: string) => {
    if (request.url) throw new Error(t('Importe uma URL por comando.'));
    if (!/^https?:\/\//i.test(value) && !value.startsWith('{{'))
      throw new Error(t('Informe uma URL HTTP(S) ou uma variável de URL do Fedexe.'));
    request.url = value;
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const split = argument.startsWith('--') ? argument.indexOf('=') : -1;
    const short = /^-[XHdum]./.test(argument);
    const key = split >= 0 ? argument.slice(0, split) : short ? argument.slice(0, 2) : argument;
    const option = options.get(key) ?? key;
    const next = () => {
      const value =
        split >= 0 ? argument.slice(split + 1) : short ? argument.slice(2) : args[++index];
      if (value === undefined) throw new Error(t('Valor ausente para {0}.', option));
      return value;
    };
    switch (option) {
      case '--url':
        setUrl(next());
        break;
      case '--request':
        method = next().toUpperCase();
        break;
      case '--head':
        method = 'HEAD';
        break;
      case '--get':
        get = true;
        break;
      case '--location':
        request.redirectPolicy = 'same_origin';
        issues.push(t('Redirecionamentos limitados à mesma origem.'));
        break;
      case '--max-time': {
        const ms = Math.round(Number(next()) * 1000);
        if (ms >= 1 && ms <= 600_000) request.timeoutMs = ms;
        else issues.push(t('Ajuste o timeout no editor.'));
        break;
      }
      case '--header': {
        const header = next();
        const colon = header.indexOf(':');
        if (colon > 0)
          headers.push(pair(header.slice(0, colon).trim(), header.slice(colon + 1).trim()));
        else issues.push(t('Uma diretiva de header precisa ser configurada.'));
        break;
      }
      case '--user': {
        const [username, ...password] = next().split(':');
        request.auth = { ...request.auth, type: 'basic', username, password: password.join(':') };
        if (!password.length) issues.push(t('Configure a senha da autorização Basic.'));
        break;
      }
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--json': {
        const value = next();
        if (option !== '--data-raw' && value.startsWith('@')) {
          issues.push(t('Selecione o arquivo do corpo no editor.'));
          binary = true;
        } else data.push(value);
        json ||= option === '--json';
        break;
      }
      case '--form':
      case '-F':
      case '--form-string': {
        const field = next();
        const separator = field.indexOf('=');
        if (separator < 1) throw new Error(t('Informe o nome de cada parte multipart.'));
        const name = field.slice(0, separator);
        const value = field.slice(separator + 1);
        const file = option !== '--form-string' && value.startsWith('@');
        if (file) issues.push(t('Selecione o arquivo da parte {0}.', name));
        if (option !== '--form-string' && (value.startsWith('<') || value.includes(';type=')))
          issues.push(t('Revise o conteúdo e o tipo da parte {0}.', name));
        multipart.push({
          ...pair(name, file || (option !== '--form-string' && value.startsWith('<')) ? '' : value),
          kind: file ? 'file' : 'field',
        });
        break;
      }
      case '--upload-file':
      case '-T':
        next();
        binary = true;
        method ||= 'PUT';
        issues.push(t('Selecione o arquivo binário no editor.'));
        break;
      case '--data-urlencode': {
        const field = next();
        const separator = field.indexOf('=');
        if (separator < 0 && field.includes('@')) {
          issues.push(t('Reconfigure o campo URL-encoded que usa um arquivo.'));
          break;
        }
        data.push(
          separator < 0
            ? encodeURIComponent(field)
            : field.slice(0, separator + 1) + encodeURIComponent(field.slice(separator + 1)),
        );
        break;
      }
      case '--silent':
      case '-s':
      case '--show-error':
      case '-S':
      case '--compressed':
        break;
      default:
        if (argument.startsWith('-') || !/^https?:\/\/|^\{\{/i.test(argument))
          throw new Error(
            t(
              'O comando contém opções ou argumentos sem suporte. Importe apenas uma requisição cURL.',
            ),
          );
        setUrl(argument);
    }
  }
  if (!request.url) throw new Error(t('Informe a URL da requisição.'));
  const selectedMethod =
    method || (get ? 'GET' : data.length || binary || multipart.length ? 'POST' : 'GET');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(selectedMethod))
    throw new Error(t('O método cURL precisa ser configurado manualmente.'));
  const result = syncUrl({
    ...request,
    method: selectedMethod as Method,
    headers,
    auth: request.auth.type === 'inherit' ? { ...request.auth, type: 'none' } : request.auth,
  });
  const body = data.join(json ? '' : '&');
  if (multipart.length) {
    if (binary || data.length || get)
      throw new Error(t('Importe apenas um tipo de corpo por comando.'));
    result.bodyType = 'multipart';
    result.multipart = multipart;
    if (headers.some(({ key }) => key.toLowerCase() === 'content-type'))
      issues.push(t('Revise o Content-Type manual para deixar o Fedexe gerar o boundary.'));
  } else if (get && body) {
    result.params.push(
      ...Array.from(new URLSearchParams(body), ([name, value]) => pair(name, value)),
    );
  } else if (binary) {
    result.bodyType = 'binary';
    if (body) issues.push(t('Revise os dados adicionais do corpo antes de enviar.'));
  } else if (data.length) {
    const contentType = headers.find(({ key }) => key.toLowerCase() === 'content-type')?.value;
    result.bodyType = json || contentType?.includes('application/json') ? 'json' : 'text';
    result.body = body;
    if (!contentType && !json)
      result.headers.push(pair('Content-Type', 'application/x-www-form-urlencoded'));
    if (json && !headers.some(({ key }) => key.toLowerCase() === 'accept'))
      result.headers.push(pair('Accept', 'application/json'));
  }
  return { request: result, issues };
}
