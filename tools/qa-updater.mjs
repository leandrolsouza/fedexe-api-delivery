import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const [binary, installer, pfx] = process.argv.slice(2);
const dir = process.env.FEDEXE_UPDATER_QA_DIR;
const manifest = JSON.parse(await readFile(join(dirname(installer), 'latest.json'), 'utf8'));
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
  do {
    const value = await check();
    if (value) return value;
    await pause(150);
  } while (Date.now() < end);
  throw new Error('Timed out: ' + label);
}

const app = spawn(binary, { windowsHide: true, stdio: 'ignore' });
let counter = 0;
async function evaluate(expression) {
  const id = ++counter;
  const path = join(dir, 'request-' + id + '.js');
  await writeFile(path + '.tmp', expression);
  await rename(path + '.tmp', path);
  const result = await until('evaluate ' + expression, async () => {
    try {
      return JSON.parse(await readFile(join(dir, 'result-' + id + '.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }, 15);
  if (result.error) throw new Error(result.error);
  return result.value;
}

const native = (cmd, args = {}) =>
  evaluate('window.__TAURI__.core.invoke(' + JSON.stringify(cmd) + ',' + JSON.stringify(args) + ')');
const dialogText = () => evaluate("document.querySelector('[role=dialog]')?.textContent ?? ''");
const button = (label) =>
  "Array.from(document.querySelectorAll('button')).find(el => " +
  '(el.getAttribute("aria-label") ?? el.textContent.trim()) === ' + JSON.stringify(label) + ')';
const click = (label) => until('click ' + label, () =>
  evaluate('(() => { const button = ' + button(label) + '; if (!button || button.disabled) return false; button.click(); return true; })()'));
const hasNote = async (locale) => (await dialogText()).includes(manifest.localizedNotes[locale].split(/\r?\n/)[0]);

try {
  await until('English update notice', () => hasNote('en-US'));
  await click('Later');
  await until('Later closes the notice', async () => (await dialogText()) === '');
  console.log('English notes and Later passed');
  await click('Settings');
  await click('View update');
  await until('update reopened from Settings', async () => (await dialogText()).includes('2.1.0'));

  await evaluate("(() => { localStorage.setItem('fedexe.locale', 'pt-BR'); setTimeout(() => location.reload(), 500); return true; })()");
  await pause(750);
  await until('Portuguese update notice', () => hasNote('pt-BR'));
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

  await until('open sample request', () => evaluate(
    "(() => { const row = document.querySelector('.tree-request-main'); if (!row) return false; row.click(); return true; })()"));
  await until('create request draft', () => evaluate(
    "(() => { const input = document.querySelector('input.request-name'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, 'Updater QA request'); input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()"));
  await click('Configurações');
  await click('Ver atualização');
  await until('pending draft blocks install', async () =>
    (await dialogText()).includes('Salve ou descarte os rascunhos antes de instalar.') &&
    await evaluate(button('Instalar atualização') + '?.disabled'));
  console.log('Portuguese notes and draft guard passed');
  await click('Adiar');
  await until('return to draft', () => evaluate(
    "(() => { const row = document.querySelector('.tree-request-main:has(.dirty-dot)'); if (!row) return false; row.click(); return true; })()"));
  await until('save the draft', () => evaluate(
    "(() => { const save = document.querySelector('.heading-actions > button'); if (!save || save.disabled) return false; save.click(); return true; })()"));
  await click('Configurações');
  await click('Ver atualização');
  await click('Instalar atualização');
  await until('invalid signature rejected', async () => (await dialogText()).includes('A assinatura do pacote não pôde ser validada'));
  assert.equal(app.exitCode, null);
  console.log('Corrupted installer was rejected and app stayed open');

  tampered = false;
  const before = await native('load_workspace');
  const saved = JSON.parse(before);
  assert.ok(saved.collections.some((item) => item.requests.some((request) => request.name === 'Updater QA request')));
  await writeFile(join(dir, 'expected-workspace.json'), before);
  await writeFile(join(dir, 'environment-id.txt'), workspace.environments[0].id);
  await click('Instalar atualização');
  await until('updater closes the previous app', () => app.exitCode !== null, 120);
} finally {
  server.closeAllConnections();
  server.close();
  if (app.exitCode === null) app.kill();
}
