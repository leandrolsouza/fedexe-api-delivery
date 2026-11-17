import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { dirname } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const [binary, installer, pfx] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(dirname(installer) + '/latest.json', 'utf8'));
const signature = (await readFile(installer + '.sig', 'utf8')).trim();
const payload = await readFile(installer);
const corrupted = Buffer.from(payload);
corrupted[corrupted.length - 1] ^= 1;
let tampered = true;
manifest.platforms['windows-x86_64'] = {
  signature,
  url: 'https://localhost:4231/update.exe',
};
const server = createServer(
  { pfx: await readFile(pfx), passphrase: 'disposable-ci-fixture' },
  (request, response) => {
    console.log('HTTPS request', request.url);
    if (request.url === '/latest.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(manifest));
    } else if (request.url === '/update.exe') {
      response.setHeader('Content-Length', payload.length);
      response.end(tampered ? corrupted : payload);
    } else {
      response.writeHead(404).end();
    }
  },
);
await new Promise((resolve) => server.listen(4231, resolve));

async function until(label, check, seconds = 35) {
  const end = Date.now() + seconds * 1000;
  let error;
  do {
    try {
      const value = await check();
      if (value) return value;
    } catch (cause) {
      error = cause;
    }
    await pause(300);
  } while (Date.now() < end);
  throw new Error('Timed out: ' + label, { cause: error });
}

async function connect() {
  const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const target = targets.find((entry) => entry.type === 'page' && entry.url.includes('tauri.localhost'));
  if (!target) return undefined;
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  return {
    close: () => socket.close(),
    run(expression) {
      return new Promise((resolve, reject) => {
        const request = ++id;
        const timer = setTimeout(() => finish(reject, new Error('DevTools timeout: ' + expression)), 5000);
        const finish = (callback, value) => {
          clearTimeout(timer);
          socket.removeEventListener('message', receive);
          callback(value);
        };
        const receive = ({ data }) => {
          const message = JSON.parse(data);
          if (message.id !== request) return;
          const error = message.error ?? message.result?.exceptionDetails;
          if (error) finish(reject, new Error(JSON.stringify(error)));
          else finish(resolve, message.result?.result?.value);
        };
        socket.addEventListener('message', receive);
        try {
          socket.send(JSON.stringify({
            id: request, method: 'Runtime.evaluate',
            params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
          }));
        } catch (error) {
          finish(reject, error);
        }
      });
    },
  };
}

const app = spawn(binary, { windowsHide: true, stdio: 'ignore' });
let cdp;
const native = (cmd, args = {}) =>
  cdp.run('window.__TAURI__.core.invoke(' + JSON.stringify(cmd) + ',' + JSON.stringify(args) + ')');
const dialogText = () => cdp.run("document.querySelector('[role=dialog]')?.textContent ?? ''");
const button = (label, selector = 'button') =>
  'Array.from(document.querySelectorAll(' + JSON.stringify(selector) + ')).find(el => ' +
  '(el.getAttribute("aria-label") ?? el.textContent.trim()) === ' + JSON.stringify(label) + ')';
const click = (label) => until('click ' + label, () =>
  cdp.run('(() => { const button = ' + button(label) + '; if (!button || button.disabled) return false; button.click(); return true; })()'));

try {
  cdp = await until('WebView2 DevTools', connect);
  await until('English update notice', async () => (await dialogText()).includes(manifest.localizedNotes['en-US'].split('\n')[0]));
  await click('Later');
  await until('Later closes the notice', async () => (await dialogText()) === '');
  console.log('English notes and Later passed');
  await click('Settings');
  await click('Updates and about');
  await click('View update');
  await until('update reopened from Settings', async () => (await dialogText()).includes('2.1.0'));

  await cdp.run("localStorage.setItem('fedexe.locale', 'pt-BR'); setTimeout(() => location.reload(), 25); true");
  await until('Portuguese update notice', async () => (await dialogText()).includes(manifest.localizedNotes['pt-BR'].split('\n')[0]));
  await click('Adiar');
  const workspace = await until('seed workspace', async () => {
    const contents = await native('load_workspace');
    return contents && JSON.parse(contents);
  });
  assert.ok(workspace.collections.length);
  assert.ok(workspace.environments.length >= 2);
  await native('write_secret', {
    environment: workspace.environments[0].id, variable: 'FEDExE_QA', value: 'disposable-fixture',
  });

  await until('open sample request', () => cdp.run(
    "(() => { const row = document.querySelector('.tree-request-main'); if (!row) return false; row.click(); return true; })()"));
  await until('create request draft', () => cdp.run(
    "(() => { const input = document.querySelector('input.request-name'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, 'Updater QA request'); input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()"));
  await click('Configurações');
  await click('Atualizações e sobre');
  await click('Ver atualização');
  await until('pending draft blocks install', async () =>
    (await dialogText()).includes('Salve ou descarte os rascunhos antes de instalar.') &&
    await cdp.run(button('Instalar atualização') + '?.disabled'));
  console.log('Portuguese notes and draft guard passed');
  await click('Adiar');
  await until('return to draft', () => cdp.run(
    "(() => { const row = document.querySelector('.tree-request-main:has(.dirty-dot)'); if (!row) return false; row.click(); return true; })()"));
  await click('Salvar');
  await click('Configurações');
  await click('Atualizações e sobre');
  await click('Ver atualização');
  await click('Instalar atualização');
  await until('invalid signature rejected', async () => (await dialogText()).includes('A assinatura do pacote não pôde ser validada'));
  assert.equal(app.exitCode, null);
  console.log('Corrupted installer was rejected and app stayed open');

  tampered = false;
  const before = JSON.parse(await native('load_workspace'));
  await click('Instalar atualização');
  await until('updater closes the previous app', () => app.exitCode !== null, 120);
  cdp.close();
  cdp = await until('app relaunched on 2.1.0', async () => {
    const next = await connect();
    if (!next) return undefined;
    try {
      if (await next.run('window.__TAURI__?.app.getVersion()') === '2.1.0') return next;
    } catch {}
    next.close();
  }, 120);
  const after = await until('workspace available after update', async () => {
    const contents = await native('load_workspace');
    return contents && JSON.parse(contents);
  });
  assert.deepEqual(after.collections.map((item) => item.id), before.collections.map((item) => item.id));
  assert.deepEqual(after.environments.map((item) => item.id), before.environments.map((item) => item.id));
  assert.equal(await native('read_secret', { environment: workspace.environments[0].id, variable: 'FEDExE_QA' }), 'disposable-fixture');
  console.log('Valid update relaunched 2.1.0 with collections, environments and credential intact');
} finally {
  cdp?.close();
  server.closeAllConnections();
  server.close();
  if (app.exitCode === null) app.kill();
}
