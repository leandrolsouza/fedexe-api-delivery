import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { prepareCollection } from '../ui/src/lib/collection-runner';
import { isEnvironment, requestsForRun, validCollection } from '../ui/src/lib/models';

const usage = `Usage: node fedexe.mjs run --collection FILE --environment FILE
  [--folder NAME] [--secret VARIABLE=ENV_NAME] [--stop-on-failure] [--report FILE]
       node fedexe.mjs load --collection FILE --environment FILE --scenario FILE
  [--folder NAME] [--secret VARIABLE=ENV_NAME] [--report FILE]`;

function fail(message) {
  console.error(message);
  process.exitCode = 2;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function runLoad(executable, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['load'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
    });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout }));
    child.stdin.on('error', reject);
    child.stdin.end(input);
  });
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log(usage);
    return;
  }
  const load = process.argv[2] === 'load';
  let args;
  try {
    if (!load && process.argv[2] !== 'run') throw new Error();
    args = parseArgs({
      args: process.argv.slice(3),
      options: {
        collection: { type: 'string' },
        environment: { type: 'string' },
        folder: { type: 'string' },
        secret: { type: 'string', multiple: true, default: [] },
        'stop-on-failure': { type: 'boolean', default: false },
        report: { type: 'string' },
        scenario: { type: 'string' },
      },
    }).values;
    if (
      !args.collection ||
      !args.environment ||
      load !== Boolean(args.scenario) ||
      (load && args['stop-on-failure'])
    )
      throw new Error();
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
  let requests = requestsForRun(
    collection,
    args.folder === undefined ? 'collection' : 'folder',
    args.folder,
    [],
  );
  if (!requests.length) return fail('The selected collection or folder has no requests.');
  let options;
  if (load) {
    try {
      options = readJson(args.scenario);
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error();
    } catch {
      return fail('Cannot read the load scenario.');
    }
    const { request_ids: ids, ...nativeOptions } = options;
    options = nativeOptions;
    if (ids !== undefined) {
      const available = new Set(requests.map(({ id }) => id));
      if (!Array.isArray(ids) || !ids.length || ids.some((id) => !available.has(id))) {
        return fail('The scenario must select at least one request from the selected scope.');
      }
      const selected = new Set(ids);
      requests = requests.filter(({ id }) => selected.has(id));
    }
  }
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
  const binary = process.platform === 'win32' ? './fedexe-runner.exe' : './fedexe-runner';
  const executable = fileURLToPath(new URL(binary, import.meta.url));
  let report;
  try {
    const scripts = (item) => item.scripts?.before?.trim() || item.scripts?.after?.trim();
    if (options?.collection_setup === true) {
      return fail('Running a collection pre-request script before load requires the desktop app.');
    }
    if (load && (scripts(collection) || requests.some(scripts)) && options?.skip_scripts !== true) {
      return fail(
        'The selected flow contains JavaScript. Set skip_scripts to true in the scenario to run without scripts.',
      );
    }
    const run = load
      ? await runLoad(executable, JSON.stringify({ collection: input, options }))
      : spawnSync(executable, {
          input: JSON.stringify(input),
          encoding: 'utf8',
          windowsHide: true,
        });
    report = JSON.parse(run.stdout);
    if (report.schema_version !== 1 || report.exit_code !== run.status) throw new Error();
  } catch {
    return fail(
      load
        ? 'The native runner could not start the load scenario. Check the scenario file and runner installation.'
        : 'The native runner could not complete the collection.',
    );
  }

  if (load) {
    console.log(JSON.stringify(report));
  } else {
    for (const step of report.steps) {
      const result = step.result.replaceAll('_', ' ');
      const status = step.status === null ? '' : ` (HTTP ${step.status})`;
      console.log(
        `Step ${step.step}: ${result}${status}, ${step.checks_passed} passed, ${step.failures} failed`,
      );
    }
    console.log(`Run ${report.outcome.replaceAll('_', ' ')} in ${report.duration_ms} ms.`);
  }
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
