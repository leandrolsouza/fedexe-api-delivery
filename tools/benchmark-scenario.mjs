import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = 'http://127.0.0.1:4230';
const largeSteps = new Set([25, 50, 75]);
const largeBody = '{"ok":true,"padding":"' + 'x'.repeat(10 * 1024 * 1024 - 24) + '"}';
const tests = [{ type: 'status', equals: 200 }];
const requests = [
  {
    name: '01 Login',
    request: { method: 'GET', url: base + '/login' },
    tests,
    extract: { token: '/token' },
  },
  ...Array.from({ length: 99 }, (_, index) => {
    const step = index + 2;
    return {
      name:
        String(step).padStart(2, '0') + (largeSteps.has(step) ? ' Resposta 10 MiB' : ' Consulta'),
      request: {
        method: 'GET',
        url: base + '/steps/' + step,
        headers: { Authorization: 'Bearer {{token}}' },
      },
      tests,
    };
  }),
];

if (process.argv[2] === 'export' && process.argv[3]) {
  const output = process.argv[3];
  const item = requests.map(({ name, request, extract }) => ({
    name,
    request: {
      method: request.method,
      url: request.url,
      header: Object.entries(request.headers ?? {}).map(([key, value]) => ({ key, value })),
    },
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
            ...(extract ? ["pm.collectionVariables.set('token', pm.response.json().token);"] : []),
          ],
        },
      },
    ],
  }));
  writeFileSync(
    join(output, 'benchmark-fedexe.json'),
    JSON.stringify({ name: 'Benchmark Fedexe', requests }, null, 2),
  );
  const postman = {
    info: {
      name: 'Benchmark Fedexe',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item,
  };
  writeFileSync(join(output, 'benchmark-postman.json'), JSON.stringify(postman, null, 2));
  // Yaak CLI 2026.9.1 runs workspace imports in reverse file order.
  writeFileSync(
    join(output, 'benchmark-yaak-2026.9.1.json'),
    JSON.stringify({ ...postman, item: [...item].reverse() }, null, 2),
  );
} else if (process.argv[2] === 'verify') {
  const file = process.argv[3];
  if (!file) throw new Error('Uso: benchmark-scenario.mjs verify caminho-do-log.ndjson');
  const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/);
  if (lines.length % requests.length !== 0)
    throw new Error(`Log incompleto: ${lines.length} registros.`);
  const loginBytes = Buffer.byteLength(JSON.stringify({ token: '0'.repeat(36) }));
  for (const [index, line] of lines.entries()) {
    const row = JSON.parse(line);
    const step = index % requests.length;
    const round = Math.floor(index / requests.length) + 1;
    const expected = new URL(requests[step].request.url).pathname;
    const bytes =
      step === 0
        ? loginBytes
        : largeSteps.has(step + 1)
          ? Buffer.byteLength(largeBody)
          : Buffer.byteLength('{"ok":true}');
    if (
      row.round !== round ||
      row.method !== 'GET' ||
      row.path !== expected ||
      row.outcome !== 'finished' ||
      row.status !== 200 ||
      row.bytes !== bytes
    ) {
      throw new Error(
        `Rodada ${round}, etapa ${step + 1}: esperava GET ${expected} concluído com status 200 e ${bytes} bytes. ` +
          `Recebido na rodada ${row.round}: ${row.method} ${row.path}, estado ${row.outcome}, status ${row.status}, ${row.bytes} bytes.`,
      );
    }
  }
  console.log(`${lines.length / requests.length} rodada(s), ${lines.length} respostas válidas.`);
} else if (process.argv[2] === 'yaak-token') {
  const login = process.argv[3];
  if (!/^rq_[a-zA-Z0-9_-]+$/.test(login ?? '')) {
    throw new Error('Informe o ID da requisição de login importada no Yaak (rq_…).');
  }
  console.log("${[ response.body.path(request='" + login + "', path='$.token') ]}");
} else {
  const delayAtSecondStep = process.argv.includes('--cancel-scenario');
  let token = '';
  let nextStep = 2;
  let round = 0;
  createServer((request, response) => {
    const startedAt = Date.now();
    if (request.method === 'GET' && request.url === '/login') round++;
    const currentRound = round;
    let bytes = 0;
    let finished = false;
    function reply(status, body) {
      bytes = Buffer.byteLength(body);
      response.writeHead(status).end(body);
    }
    function log(outcome) {
      process.stdout.write(
        JSON.stringify({
          round: currentRound,
          method: request.method,
          path: request.url,
          started_at_ms: startedAt,
          ended_at_ms: Date.now(),
          status: outcome === 'finished' ? response.statusCode : null,
          bytes: outcome === 'finished' ? bytes : null,
          outcome,
        }) + '\n',
      );
    }
    response.once('finish', () => {
      finished = true;
      log('finished');
    });
    response.once('close', () => {
      if (!finished) log('aborted');
    });
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/login') {
      token = randomUUID();
      nextStep = 2;
      reply(200, JSON.stringify({ token }));
      return;
    }
    if (!token || request.headers.authorization !== 'Bearer ' + token) {
      reply(401, '{"error":"token inválido"}');
      return;
    }
    if (request.method !== 'GET' || nextStep > 100 || request.url !== '/steps/' + nextStep) {
      reply(409, '{"error":"ordem inesperada"}');
      return;
    }
    const step = nextStep++;
    if (delayAtSecondStep && step === 2) {
      process.stdout.write(
        JSON.stringify({
          round: currentRound,
          path: request.url,
          outcome: 'waiting',
          started_at_ms: startedAt,
        }) + '\n',
      );
      const timer = setTimeout(() => reply(200, '{"ok":true}'), 5000);
      response.once('close', () => clearTimeout(timer));
      return;
    }
    reply(200, largeSteps.has(step) ? largeBody : '{"ok":true}');
  }).listen(4230, '127.0.0.1');
}
