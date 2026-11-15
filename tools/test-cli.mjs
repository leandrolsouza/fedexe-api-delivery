import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const secret = 'fixture-login-secret';
const token = 'fixture-extracted-token';
const oauthToken = 'fixture-oauth-access-token';
const calls = [];
const server = createServer(async (request, response) => {
  calls.push(request.url);
  if (request.url === '/oauth/token') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const basic = Buffer.from(`fedexe-ci:${secret}`).toString('base64');
    const authenticated =
      request.method === 'POST' &&
      request.headers.authorization === `Basic ${basic}` &&
      Buffer.concat(chunks).toString() === 'grant_type=client_credentials&scope=read';
    response.writeHead(authenticated ? 200 : 401, { 'Content-Type': 'application/json' });
    return response.end(
      JSON.stringify(
        authenticated
          ? { access_token: oauthToken, token_type: 'Bearer', expires_in: 3600 }
          : { error: 'invalid_client', error_description: secret },
      ),
    );
  }
  const login = request.url === '/login' && request.headers['x-login'] === secret;
  const authorized =
    (request.url === '/private' && request.headers.authorization === `Bearer ${token}`) ||
    (request.url === '/oauth/private' && request.headers.authorization === `Bearer ${oauthToken}`);
  response.writeHead(login || authorized ? 200 : 401, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(login ? { token } : { ok: authorized }));
});
const directory = await mkdtemp(join(tmpdir(), 'fedexe-cli-'));
const collectionPath = join(directory, 'collection.json');
const environmentPath = join(directory, 'environment.json');
const auth = {
  type: 'none',
  token: '',
  username: '',
  password: '',
  key: '',
  value: '',
  placement: 'header',
};
const variable = (key, value) => ({ id: key, key, value, enabled: true });
const request = (id, path, headers, tests, extract = {}, folder = 'CI') => ({
  id,
  name: `${id} ${secret} ${token}`,
  folder,
  method: 'GET',
  url: '{{base}}' + path,
  description: '',
  params: [],
  headers,
  bodyType: 'none',
  body: '',
  form: [],
  auth,
  tests,
  extract,
});
const status = (equals) => ({ type: 'status', equals });
const collection = {
  id: 'collection',
  name: 'CLI smoke test',
  description: '',
  folders: ['CI'],
  variables: [variable('base', 'invalid'), variable('credential', 'invalid')],
  auth,
  requests: [
    request('login', '/login', [variable('X-Login', '{{credential}}')], [status(200)], {
      token: '/token',
    }),
    request(
      'private',
      '/private',
      [variable('Authorization', 'Bearer {{token}}')],
      [
        status(200),
        { type: 'json', pointer: '/ok', equals: true },
        { type: 'header', name: 'Content-Type', equals: 'application/json' },
      ],
    ),
    request('outside', '/outside', [], [status(401)], {}, ''),
  ],
};

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['dist-cli/fedexe.mjs', 'run', ...args],
      { env: { ...process.env, FEDEXE_CLI_TEST_SECRET: secret } },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(new Error('CLI launch failed.'));
        resolve({ code: error?.code ?? 0, stdout, stderr });
      },
    );
  });
}

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  await writeFile(
    environmentPath,
    JSON.stringify({
      id: 'ci',
      name: 'CI',
      color: '',
      variables: [
        variable('base', `http://127.0.0.1:${server.address().port}`),
        { ...variable('credential', ''), secret: true },
        variable('token', 'invalid'),
      ],
    }),
  );
  const args = [
    '--collection',
    collectionPath,
    '--environment',
    environmentPath,
    '--secret',
    'credential=FEDEXE_CLI_TEST_SECRET',
  ];
  async function check(label, options, code, expectedCalls) {
    calls.length = 0;
    await writeFile(collectionPath, JSON.stringify(collection));
    const path = join(directory, label + '.json');
    const result = await run([...args, ...options, '--report', path]);
    const rawReport = await readFile(path, 'utf8');
    for (const output of [result.stdout, result.stderr, rawReport]) {
      assert.equal(
        [secret, token, oauthToken].some((value) => output.includes(value)),
        false,
        'Found a secret in CLI output.',
      );
    }
    assert.equal(result.code, code);
    const report = JSON.parse(rawReport);
    assert.equal(report.exit_code, code);
    assert.deepEqual(calls, expectedCalls);
    return report;
  }
  const success = await check('success', ['--folder', 'CI'], 0, ['/login', '/private']);
  assert.deepEqual(
    success.steps.map((step) => step.checks_passed),
    [1, 3],
  );
  await check('complete', [], 0, ['/login', '/private', '/outside']);
  collection.requests[1].tests.push(status(201));
  const failure = await check('failure', ['--stop-on-failure'], 1, ['/login', '/private']);
  assert.equal(failure.outcome, 'stopped_on_failure');
  assert.equal(failure.steps[1].result, 'validation_failed');
  collection.requests[0].url = '{{missing}}/login';
  const error = await check('execution', ['--stop-on-failure'], 2, []);
  assert.equal(error.steps[0].result, 'execution_error');
  assert.equal((await run(['--collection', collectionPath])).code, 2);
  const oauthRequest = request('oauth', '/oauth/private', [], [status(200)]);
  oauthRequest.auth = {
    ...auth,
    type: 'oauth2',
    oauth: {
      grant: 'client_credentials',
      authorization_url: '',
      token_url: '{{base}}/oauth/token',
      client_id: 'fedexe-ci',
      client_secret: '{{credential}}',
      scope: 'read',
    },
  };
  collection.requests = [oauthRequest];
  await check('oauth-success', [], 0, ['/oauth/token', '/oauth/private']);
  oauthRequest.auth.oauth.client_id = 'wrong-client';
  const oauthError = await check('oauth-error', [], 2, ['/oauth/token']);
  assert.equal(oauthError.steps[0].result, 'execution_error');
  console.log('Fedexe CLI smoke test passed.');
} finally {
  server.close();
  await rm(directory, { recursive: true, force: true });
}
