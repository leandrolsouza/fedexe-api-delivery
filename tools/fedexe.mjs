import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { prepareCollection } from '../ui/src/lib/collection-runner';
import { isEnvironment, requestsForRun, validCollection } from '../ui/src/lib/models';

const usage = `Usage: node fedexe.mjs run --collection FILE --environment FILE
  [--folder NAME] [--secret VARIABLE=ENV_NAME] [--stop-on-failure] [--report FILE]`;

function fail(message) {
  console.error(message);
  process.exitCode = 2;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function main() {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log(usage);
    return;
  }
  let args;
  try {
    if (process.argv[2] !== 'run') throw new Error();
    args = parseArgs({
      args: process.argv.slice(3),
      options: {
        collection: { type: 'string' },
        environment: { type: 'string' },
        folder: { type: 'string' },
        secret: { type: 'string', multiple: true, default: [] },
        'stop-on-failure': { type: 'boolean', default: false },
        report: { type: 'string' },
      },
    }).values;
    if (!args.collection || !args.environment) throw new Error();
  } catch {
    return fail(usage);
  }

  let collection, environment;
  try {
    collection = readJson(args.collection);
    environment = readJson(args.environment);
    if (!validCollection(collection) || !isEnvironment(environment)) throw new Error();
  } catch {
    return fail('Cannot read the Fedexe collection or environment export.');
  }

  const supplied = new Set();
  for (const mapping of args.secret) {
    const match = /^([^={}]+)=([A-Za-z_][A-Za-z0-9_]*)$/.exec(mapping);
    if (!match) return fail('Use --secret VARIABLE=ENV_NAME.');
    const [, key, source] = match;
    const value = process.env[source];
    if (!value || supplied.has(key))
      return fail('A secret mapping is missing a value or is duplicated.');
    supplied.add(key);
    environment.variables.push({ id: key, key, value, enabled: true, secret: true });
  }
  const requests = requestsForRun(
    collection,
    args.folder === undefined ? 'collection' : 'folder',
    args.folder,
    [],
  );
  if (!requests.length) return fail('The selected collection or folder has no requests.');
  for (const request of requests) {
    for (const header of request.headers) {
      if (!header.enabled || !header.secret || header.value) continue;
      const key = header.key.trim();
      if (!supplied.has(key))
        return fail('An exported secret header requires a matching --secret mapping.');
      header.value = '{{' + key + '}}';
    }
  }

  const input = prepareCollection(collection, environment, requests, args['stop-on-failure']);
  const executable = process.platform === 'win32' ? './fedexe-runner.exe' : './fedexe-runner';
  const run = spawnSync(fileURLToPath(new URL(executable, import.meta.url)), {
    input: JSON.stringify(input),
    encoding: 'utf8',
    windowsHide: true,
  });
  let report;
  try {
    report = JSON.parse(run.stdout);
    if (report.schema_version !== 1 || report.exit_code !== run.status) throw new Error();
  } catch {
    return fail('The native runner could not complete the collection.');
  }

  for (const step of report.steps) {
    const result = step.result.replaceAll('_', ' ');
    const status = step.status === null ? '' : ` (HTTP ${step.status})`;
    console.log(
      `Step ${step.step}: ${result}${status}, ${step.checks_passed} passed, ${step.failures} failed`,
    );
  }
  console.log(`Run ${report.outcome.replaceAll('_', ' ')} in ${report.duration_ms} ms.`);
  if (args.report) {
    try {
      writeFileSync(args.report, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    } catch {
      return fail('Cannot create the report. Choose a writable path that does not exist.');
    }
  }
  process.exitCode = report.exit_code;
}

main();
