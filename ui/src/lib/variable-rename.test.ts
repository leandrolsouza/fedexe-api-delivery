import { describe, expect, it } from 'vitest';
import { compileRequest, createWorkspace, newRequest, pair, variablesFor } from './models';
import { prepareSecrets } from './credentials';
import { renameReference, renameScript, renameWorkspaceVariable } from './variable-rename';

describe('variable rename', () => {
  it('preserves the resolved HTTP request and credential identities after renaming', () => {
    const workspace = createWorkspace();
    const collection = workspace.collections[0];
    const environment = workspace.environments[0];
    collection.variables.push({ ...pair('old', 'https://collection.test'), secret: true });
    environment.variables.push({ ...pair('old', 'https://environment.test'), secret: true });
    const request = {
      ...newRequest(),
      url: '{{old}}/users',
      bodyType: 'json' as const,
      body: '{"ref":"{{old}}"}',
      params: [pair('ref', '{{old}}')],
      auth: { ...collection.auth, type: 'bearer' as const, token: '{{old}}' },
    };
    collection.requests = [request];
    const http = compileRequest(request, collection, variablesFor(collection, environment));
    const credentials = prepareSecrets(workspace);
    const result = renameWorkspaceVariable(workspace, {}, 'old', 'new');
    if (typeof result === 'string') throw Error(result);
    const updated = result.workspace.collections[0];
    expect(
      compileRequest(
        updated.requests[0],
        updated,
        variablesFor(updated, result.workspace.environments[0]),
      ),
    ).toEqual(http);
    expect(prepareSecrets(result.workspace).values).toEqual(credentials.values);
    expect(JSON.stringify(prepareSecrets(result.workspace).sanitized)).not.toContain(
      'https://environment.test',
    );
  });
  it('renames shared declarations and templates while preserving IDs, secrets and environment precedence', () => {
    const workspace = createWorkspace();
    const c = workspace.collections[0];
    const env = workspace.environments[0];
    c.variables.push({ ...pair('old', 'collection-value'), secret: true });
    env.variables.push({ ...pair('old', 'environment-value'), secret: true });
    const request = c.requests[0];
    request.url = '{{ old }}/{{old_suffix}}';
    request.body = '{"id":"{{old}}"}';
    request.headers = [pair('X-{{old}}', '{{old}}')];
    request.params = [pair('id', '{{old}}')];
    request.pathParams = [pair('id', '{{old}}')];
    request.form = [pair('data', '{{old}}')];
    request.multipart = [
      { ...pair('part', '{{old}}'), kind: 'field' },
      { ...pair('file', 'C:/{{old}}.bin'), kind: 'file' },
    ];
    request.binaryFile = 'C:/{{old}}.bin';
    request.graphql = {
      query: 'query { node(id:"{{old}}") { id }}',
      variables: '{"id":"{{old}}"}',
    };
    request.auth = { ...request.auth, token: '{{old}}' };
    request.scripts = { after: "pm.variables.set('old', pm.environment.get('old'));" };
    request.extract = { old: '/id' };
    c.auth.token = '{{old}}';
    c.scripts = { before: "pm.collectionVariables.get('old')" };
    const other = {
      ...structuredClone(c),
      id: 'other',
      requests: [{ ...newRequest(), url: '{{old}}' }],
    };
    workspace.collections.push(other);
    const original = structuredClone(workspace);
    const drafts = { [request.id]: { ...request, body: 'unsaved {{old}}' } };
    const result = renameWorkspaceVariable(workspace, drafts, 'old', 'renamed');
    if (typeof result === 'string') throw Error(result);
    const renamed = result.workspace.collections[0];
    expect(renamed.variables.at(-1)).toEqual({ ...c.variables.at(-1), key: 'renamed' });
    expect(result.workspace.environments[0].variables.at(-1)).toEqual({
      ...env.variables.at(-1),
      key: 'renamed',
    });
    expect(variablesFor(renamed, result.workspace.environments[0]).renamed).toBe(
      'environment-value',
    );
    expect(renamed.requests[0]).toMatchObject({
      url: '{{ renamed }}/{{old_suffix}}',
      body: '{"id":"{{renamed}}"}',
      auth: { token: '{{renamed}}' },
      extract: { renamed: '/id' },
      binaryFile: 'C:/{{old}}.bin',
    });
    expect(renamed.requests[0].headers[0]).toMatchObject({
      key: 'X-{{renamed}}',
      value: '{{renamed}}',
    });
    expect(renamed.requests[0].params[0].value).toBe('{{renamed}}');
    expect(renamed.requests[0].pathParams?.[0].value).toBe('{{renamed}}');
    expect(renamed.requests[0].form[0].value).toBe('{{renamed}}');
    expect(renamed.requests[0].multipart?.map((row) => row.value)).toEqual([
      '{{renamed}}',
      'C:/{{old}}.bin',
    ]);
    expect(renamed.requests[0].graphql?.variables).toBe('{"id":"{{renamed}}"}');
    expect(renamed.auth.token).toBe('{{renamed}}');
    expect(renamed.scripts?.before).toBe('pm.collectionVariables.get("renamed")');
    expect(result.workspace.collections[1].requests[0].url).toBe('{{renamed}}');
    expect(result.drafts[request.id].body).toBe('unsaved {{renamed}}');
    expect(workspace).toEqual(original);
    expect(drafts[request.id].body).toBe('unsaved {{old}}');
  });

  it('rewrites only exact template names and literal variable API arguments, not unrelated strings or comments', () => {
    expect(renameReference('{{ old }} {{old_suffix}} {{x.old}}', 'old', 'new')).toBe(
      '{{ new }} {{old_suffix}} {{x.old}}',
    );
    const source = `// pm.environment.get('old')
const label = 'old';
pm.environment.get('old');
pm.variables.set("old", 'old');
pm.collectionVariables.unset(\`old\`);
pm['variables'].has('old');
pm.environment.get(prefix + 'old');
pm.environment.get('\\u006fld');
pm.variables.replaceIn('{{old}}');`;
    const renamed = renameScript(source, 'old', 'new');
    expect(renamed).toContain("// pm.environment.get('old')");
    expect(renamed).toContain("const label = 'old'");
    expect(renamed).toContain('pm.environment.get("new")');
    expect(renamed).toContain('pm.variables.set("new", \'old\')');
    expect(renamed).toContain('pm.collectionVariables.unset("new")');
    expect(renamed).toContain('pm[\'variables\'].has("new")');
    expect(renamed).toContain("pm.environment.get(prefix + 'old')");
    expect(renamed).toContain("pm.variables.replaceIn('{{new}}')");
  });

  it('rejects collisions in disabled declarations, extractions and script producers without mutation', () => {
    const workspace = createWorkspace();
    const c = workspace.collections[0];
    workspace.environments[0].variables.push(pair('new', 'keep', false));
    expect(renameWorkspaceVariable(workspace, {}, 'old', 'new')).toBe('collision');
    workspace.environments[0].variables.pop();
    c.requests[0].extract = { new: '/keep' };
    expect(renameWorkspaceVariable(workspace, {}, 'old', 'new')).toBe('collision');
    c.requests[0].extract = {};
    c.scripts = { before: "pm.variables.set('new', 'keep')" };
    expect(renameWorkspaceVariable(workspace, {}, 'old', 'new')).toBe('collision');
    c.scripts = undefined;
    const draft = { ...c.requests[0], extract: { new: '/id' } };
    expect(renameWorkspaceVariable(workspace, { [draft.id]: draft }, 'old', 'new')).toBe(
      'collision',
    );
    expect(renameWorkspaceVariable(workspace, {}, 'old', '{{new}}')).toBe('invalid');
    expect(renameWorkspaceVariable(workspace, {}, 'old', 'new"name')).toBe('invalid');
  });
});
