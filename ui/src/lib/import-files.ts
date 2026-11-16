import { t } from './i18n';
import { importCollection, isEnvironment, isWorkspace } from './models';
import { importOpenApi, parseImport } from './openapi';
import { importPostman } from './postman';
import { normalizeError } from './transport';
import { uid } from './utils';
import type { Collection, Environment } from './models';

export function importDocument(text: string) {
  const parsed = parseImport(text);
  const openApi = importOpenApi(parsed);
  if (openApi) return { kind: 'openapi' as const, ...openApi };
  if (isWorkspace(parsed)) return { kind: 'backup' as const, workspace: parsed };

  const postman = importPostman(parsed);
  const environment =
    postman?.environment ?? (isEnvironment(parsed) ? { ...parsed, id: uid() } : undefined);
  if (environment)
    return { kind: 'environment' as const, environment, issues: postman?.issues ?? [] };
  return {
    kind: 'collection' as const,
    collection: postman?.collection ?? importCollection(parsed),
    issues: postman?.issues,
  };
}

type ImportFile = Pick<File, 'name' | 'size' | 'text'>;

export function readImportFile(file: ImportFile) {
  if (file.size > 10 * 1024 * 1024)
    throw new Error(t('O arquivo excede o limite de importação de 10 MB.'));
  return file.text();
}

export async function importFileBatch(files: ImportFile[]) {
  const collections: Collection[] = [];
  const environments: Environment[] = [];
  const entries: string[] = [];
  const issues: string[] = [];
  let succeeded = 0;
  let activeEnvironment: string | undefined;
  for (const file of files) {
    try {
      const result = importDocument(await readImportFile(file));
      if (result.kind === 'backup')
        throw new Error(t('Selecione o backup sozinho para restaurar o workspace.'));
      if (result.kind !== 'environment') {
        collections.push(result.collection);
        if (collections.length === 1 && result.kind === 'openapi')
          activeEnvironment = result.environment.id;
      }
      if (result.kind !== 'collection') environments.push(result.environment);
      const name = result.kind === 'environment' ? result.environment.name : result.collection.name;
      entries.push(t('{0}: {1} importado com sucesso.', file.name, name));
      for (const issue of result.issues ?? []) issues.push(t('{0}: {1}', file.name, issue));
      succeeded++;
    } catch (error) {
      issues.push(t('{0}: {1}', file.name, normalizeError(error).message));
    }
  }
  return { collections, environments, activeEnvironment, succeeded, entries, issues };
}
