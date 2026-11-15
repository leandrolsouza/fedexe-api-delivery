import { t } from './i18n';
import type { Collection, Environment } from './models';
import { importPostman } from './postman';

type Kind = 'collection' | 'environment';
export type PostmanResource =
  { kind: 'workspaces'; cursor?: string } | { kind: 'workspace' | Kind; id: string };
export type PostmanGet = (resource: PostmanResource) => Promise<unknown>;
type Ref = { id: string; name: string };
export type PostmanItem = Ref & { kind: Kind };
export type PostmanImport = {
  collections: Collection[];
  environments: Environment[];
  issues: string[];
};

const omitted = ['apis', 'specs', 'mocks', 'monitors', 'flows'] as const;
type Omitted = (typeof omitted)[number];

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function refs(value: unknown, preferUid = false): Ref[] {
  if (!Array.isArray(value)) throw new Error('invalidResponse');
  return value.map((item) => {
    const { uid, id, name } = object(item);
    const reference = preferUid && typeof uid === 'string' && uid ? uid : id;
    if (typeof reference !== 'string' || !reference || typeof name !== 'string')
      throw new Error('invalidResponse');
    return { id: reference, name };
  });
}

export function listPostmanWorkspaces(response: unknown) {
  const data = object(response);
  const cursor = object(data.meta).nextCursor;
  return { items: refs(data.workspaces), cursor: typeof cursor === 'string' ? cursor : '' };
}

export function readPostmanWorkspace(response: unknown) {
  const workspace = object(object(response).workspace);
  if (typeof workspace.name !== 'string') throw new Error('invalidResponse');
  const items: PostmanItem[] = [
    ...refs(workspace.collections ?? [], true).map((item) => ({
      ...item,
      kind: 'collection' as const,
    })),
    ...refs(workspace.environments ?? [], true).map((item) => ({
      ...item,
      kind: 'environment' as const,
    })),
  ];
  const unsupported = omitted.flatMap((type) => {
    const entries = workspace[type];
    return Array.isArray(entries) && entries.length ? [{ type, count: entries.length }] : [];
  });
  return { name: workspace.name, items, unsupported };
}

export function itemKey(item: PostmanItem) {
  return `${item.kind}:${item.id}`;
}

export function postmanError(error: unknown) {
  switch (error instanceof Error ? error.message : error) {
    case 'unauthorized':
      return t('A chave do Postman é inválida ou expirou.');
    case 'forbidden':
      return t('A chave do Postman não dá acesso a este recurso.');
    case 'notFound':
      return t('O recurso não está mais disponível no Postman.');
    case 'rateLimit':
      return t('O Postman limitou as chamadas. Aguarde e tente novamente.');
    case 'missingKey':
      return t('Informe uma chave de API do Postman.');
    case 'vault':
      return t('Não foi possível acessar a chave no cofre do Windows.');
    case 'network':
      return t('Não foi possível conectar à API do Postman.');
    case 'tooLarge':
      return t('A resposta do Postman excede o limite de 10 MB.');
    default:
      return t('Não foi possível ler o recurso do Postman.');
  }
}

const omittedLabel: Record<Omitted, 'APIs' | 'OpenAPI' | 'Mocks' | 'Monitores' | 'Flows'> = {
  apis: 'APIs',
  specs: 'OpenAPI',
  mocks: 'Mocks',
  monitors: 'Monitores',
  flows: 'Flows',
};

export function unsupportedPostmanIssues(workspace: ReturnType<typeof readPostmanWorkspace>) {
  return workspace.unsupported.map(({ type, count }) =>
    t('{0}: {1} item(ns) sem suporte à importação.', t(omittedLabel[type]), count),
  );
}

export async function importPostmanItems(
  items: PostmanItem[],
  get: PostmanGet,
  workspaceIssues: string[],
): Promise<PostmanImport> {
  const result: PostmanImport = { collections: [], environments: [], issues: [...workspaceIssues] };
  for (const item of items) {
    let response: unknown;
    try {
      response = await get({ kind: item.kind, id: item.id });
    } catch (error) {
      result.issues.push(t('{0}: {1}', item.name, postmanError(error)));
      continue;
    }
    const data = object(object(response)[item.kind]);
    try {
      const imported = importPostman(
        item.kind === 'environment' ? { ...data, _postman_variable_scope: 'environment' } : data,
      );
      if (item.kind === 'collection' && imported?.collection)
        result.collections.push(imported.collection);
      else if (item.kind === 'environment' && imported?.environment)
        result.environments.push(imported.environment);
      else throw new Error();
      result.issues.push(...imported.issues);
    } catch {
      result.issues.push(t('{0}: {1}', item.name, postmanError('invalidResponse')));
    }
  }
  return result;
}
