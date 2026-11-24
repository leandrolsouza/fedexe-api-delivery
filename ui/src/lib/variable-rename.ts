import { javascriptLanguage } from '@codemirror/lang-javascript';
import type { Auth, Pair, RequestItem, Workspace } from './models';
import type { Scripts } from './scripts';

export type VariableRenameError = 'invalid' | 'collision';

export function renameReference(text: string, from: string, to: string) {
  return text.replace(/\{\{([^{}]+)\}\}/g, (token, name: string) => {
    if (name.trim() !== from) return token;
    const leading = name.match(/^\s*/)?.[0] ?? '';
    const trailing = name.match(/\s*$/)?.[0] ?? '';
    return `{{${leading}${to}${trailing}}}`;
  });
}

function literalValue(raw: string) {
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return undefined;
    }
  }
  if (raw.startsWith('`') && raw.includes('${')) return undefined;
  return raw
    .slice(1, -1)
    .replace(/\\(u\{[\da-f]+\}|u[\da-f]{4}|x[\da-f]{2}|\r?\n|.)/gi, (_, escape: string) => {
      if (/^u\{/.test(escape)) return String.fromCodePoint(parseInt(escape.slice(2, -1), 16));
      if (/^[ux]/.test(escape)) return String.fromCharCode(parseInt(escape.slice(1), 16));
      return (
        (
          {
            n: '\n',
            r: '\r',
            t: '\t',
            b: '\b',
            f: '\f',
            v: '\v',
            '0': '\0',
            '\n': '',
            '\r\n': '',
          } as Record<string, string>
        )[escape] ?? escape
      );
    });
}

function scriptVariableArguments(source: string) {
  const argumentsFound: { from: number; to: number; name: string; method: string }[] = [];
  javascriptLanguage.parser.parse(source).iterate({
    enter(node) {
      if (!['String', 'TemplateString'].includes(node.name)) return;
      const parent = node.node.parent;
      if (parent?.name !== 'ArgList' || node.node.prevSibling?.name !== '(') return;
      const callee = parent.prevSibling;
      if (!callee) return;
      const access = source
        .slice(callee.from, callee.to)
        .replace(/\s/g, '')
        .replace(
          /\[(["'])(variables|environment|collectionVariables|get|has|set|unset)\1\]/g,
          '.$2',
        )
        .replace(/\?\./g, '.');
      const api = access.match(
        /^pm\.(variables|environment|collectionVariables)\.(get|has|set|unset)$/,
      );
      if (!api) return;
      try {
        const name = literalValue(source.slice(node.from, node.to));
        if (name !== undefined)
          argumentsFound.push({ from: node.from, to: node.to, name, method: api[2] });
      } catch {
        /* Ignore malformed literals in an unfinished script. */
      }
    },
  });
  return argumentsFound;
}

export function renameScript(source: string, from: string, to: string) {
  const edits = scriptVariableArguments(source).filter((argument) => argument.name === from);
  for (const edit of edits.sort((a, b) => b.from - a.from))
    source = source.slice(0, edit.from) + JSON.stringify(to) + source.slice(edit.to);
  return renameReference(source, from, to);
}

export function renameRequestReferences(
  request: RequestItem,
  from: string,
  to: string,
): RequestItem {
  const replace = (text: string) => renameReference(text, from, to);
  const pairs = <T extends Pair>(rows: T[]) =>
    rows.map((row) => ({ ...row, key: replace(row.key), value: replace(row.value) }));
  return {
    ...request,
    url: replace(request.url),
    description: replace(request.description),
    body: replace(request.body),
    params: pairs(request.params),
    headers: pairs(request.headers),
    form: pairs(request.form),
    pathParams: request.pathParams && pairs(request.pathParams),
    multipart: request.multipart?.map((row) => ({
      ...row,
      key: replace(row.key),
      value: row.kind === 'file' ? row.value : replace(row.value),
    })),
    graphql: request.graphql && {
      query: replace(request.graphql.query),
      variables: replace(request.graphql.variables),
    },
    auth: renameAuth(request.auth, from, to),
    scripts: renameScripts(request.scripts, from, to),
    extract: Object.fromEntries(
      Object.entries(request.extract).map(([key, pointer]) => [key === from ? to : key, pointer]),
    ),
  };
}

function renameAuth(auth: Auth, from: string, to: string): Auth {
  const replace = (text: string) => renameReference(text, from, to);
  return {
    ...auth,
    token: replace(auth.token),
    username: replace(auth.username),
    password: replace(auth.password),
    key: replace(auth.key),
    value: replace(auth.value),
    oauth: auth.oauth && {
      ...auth.oauth,
      authorization_url: replace(auth.oauth.authorization_url),
      token_url: replace(auth.oauth.token_url),
      client_id: replace(auth.oauth.client_id),
      client_secret: replace(auth.oauth.client_secret),
      scope: replace(auth.oauth.scope),
    },
  };
}
function renameScripts(
  scripts: Scripts | undefined,
  from: string,
  to: string,
): Scripts | undefined {
  return (
    scripts && {
      ...scripts,
      before: scripts.before === undefined ? undefined : renameScript(scripts.before, from, to),
      after: scripts.after === undefined ? undefined : renameScript(scripts.after, from, to),
    }
  );
}

export function renameWorkspaceVariable(
  workspace: Workspace,
  drafts: Record<string, RequestItem>,
  from: string,
  to: string,
): { workspace: Workspace; drafts: Record<string, RequestItem> } | VariableRenameError {
  if (!/^[\p{L}\p{M}\p{N}_.-]+$/u.test(to)) return 'invalid';
  if (from === to) return { workspace, drafts };
  const declarations = [
    ...workspace.collections.flatMap((c) => c.variables),
    ...workspace.environments.flatMap((e) => e.variables),
  ];
  if (
    declarations.some((row) => row.key === to) ||
    [...workspace.collections.flatMap((c) => c.requests), ...Object.values(drafts)].some(
      (request) => Object.hasOwn(request.extract, to),
    )
  )
    return 'collision';
  const scripts = [
    ...workspace.collections.flatMap((collection) => [
      collection.scripts,
      ...collection.requests.map((request) => request.scripts),
    ]),
    ...Object.values(drafts).map((request) => request.scripts),
  ];
  const sources = [
    ...scripts.flatMap((script) => [script?.before, script?.after]),
    ...workspace.collections.flatMap(({ folderPreRequests, folderPostResponses }) =>
      [folderPreRequests, folderPostResponses].flatMap((scripts) =>
        Object.values(scripts ?? {}).flat(),
      ),
    ),
  ];
  if (
    sources.some(
      (source) =>
        source &&
        scriptVariableArguments(source).some(
          (argument) => argument.method === 'set' && argument.name === to,
        ),
    )
  )
    return 'collision';
  const variables = (rows: Pair[]) =>
    rows.map((row) => ({ ...row, key: row.key === from ? to : row.key }));
  const renameFolderScripts = (scripts?: Record<string, string[]>) =>
    scripts &&
    Object.fromEntries(
      Object.entries(scripts).map(([path, sources]) => [
        path,
        sources.map((source) => renameScript(source, from, to)),
      ]),
    );
  const collections = workspace.collections.map((collection) => ({
    ...collection,
    variables: variables(collection.variables),
    auth: renameAuth(collection.auth, from, to),
    scripts: renameScripts(collection.scripts, from, to),
    folderPreRequests: renameFolderScripts(collection.folderPreRequests),
    folderPostResponses: renameFolderScripts(collection.folderPostResponses),
    requests: collection.requests.map((request) => renameRequestReferences(request, from, to)),
  }));
  return {
    workspace: {
      ...workspace,
      collections,
      environments: workspace.environments.map((env) => ({
        ...env,
        variables: variables(env.variables),
      })),
    },
    drafts: Object.fromEntries(
      Object.entries(drafts).map(([id, request]) => [
        id,
        renameRequestReferences(request, from, to),
      ]),
    ),
  };
}
