import { t } from './i18n';
import { mapWorkspaceCredentials, type Auth, type RequestItem, type Workspace } from './models';

export type BackupAttachment = {
  collectionId: string;
  requestId: string;
  location: string;
  name: string;
  path: string;
  partId?: string;
};

function attachmentReferences(workspace: Workspace): BackupAttachment[] {
  return workspace.collections.flatMap((collection) =>
    collection.requests.flatMap((request): BackupAttachment[] => {
      const target = {
        collectionId: collection.id,
        requestId: request.id,
        location: `${collection.name} / ${request.name}`,
      };
      if (request.bodyType === 'binary')
        return [{ ...target, name: t('Arquivo binário'), path: request.binaryFile ?? '' }];
      if (request.bodyType !== 'multipart') return [];
      return (request.multipart ?? [])
        .filter((row) => row.enabled && row.kind === 'file')
        .map((row) => ({
          ...target,
          name: row.key || t('Arquivo multipart'),
          path: row.value,
          partId: row.id,
        }));
    }),
  );
}

export function replaceBackupAttachment(
  request: RequestItem,
  attachment: BackupAttachment,
  path: string,
): RequestItem {
  if (attachment.partId === undefined && request.bodyType === 'binary')
    return { ...request, binaryFile: path };
  if (request.bodyType !== 'multipart') return request;
  return {
    ...request,
    multipart: request.multipart?.map((row) =>
      row.id === attachment.partId && row.kind === 'file' ? { ...row, value: path } : row,
    ),
  };
}

function authSecretLabel(auth: Auth, field: string[]) {
  switch (auth.type) {
    case 'basic':
      if (field[0] === 'username') return t('Usuário');
      if (field[0] === 'password') return t('Senha');
      break;
    case 'bearer':
      if (field[0] === 'token') return t('Token');
      break;
    case 'api-key':
      if (field[0] === 'value') return auth.key || t('API key');
      break;
    case 'oauth2':
      if (auth.oauth?.grant === 'client_credentials' && field[1] === 'client_secret')
        return t('Client secret');
      break;
  }
}

function emptySecrets(workspace: Workspace) {
  const secrets: { id: string; location: string; name: string }[] = [];
  const environments = new Map(workspace.environments.map((env) => [env.id, env]));
  const collections = new Map(
    workspace.collections.map((collection) => [collection.id, collection]),
  );
  const requests = new Map(
    workspace.collections.flatMap((collection) =>
      collection.requests.map((request) => [JSON.stringify([collection.id, request.id]), request]),
    ),
  );
  mapWorkspaceCredentials(workspace, (scope, owner, field, value) => {
    if (value) return value;
    const id = JSON.stringify([scope, owner, field]);
    if (scope === 'environment') {
      const env = environments.get(owner);
      const row = env?.variables.find(({ id }) => id === field[0]);
      if (env && row?.enabled && row.key) secrets.push({ id, location: env.name, name: row.key });
      return value;
    }
    const collection = collections.get(owner);
    if (!collection) return value;
    const request =
      field[0] === 'request' ? requests.get(JSON.stringify([owner, field[1]])) : undefined;
    const [group, key, ...rest] = request ? field.slice(2) : field;
    const location = request ? `${collection.name} / ${request.name}` : collection.name;
    if (group === 'auth') {
      const name = authSecretLabel((request ?? collection).auth, [key, ...rest]);
      if (name) secrets.push({ id, location, name });
    }
    const rows =
      group === 'variables'
        ? collection.variables
        : group === 'headers' ||
            group === 'params' ||
            group === 'pathParams' ||
            group === 'form' ||
            group === 'multipart'
          ? request?.[group]
          : undefined;
    const row = rows?.find(({ id }) => id === key);
    if (row?.enabled && row.key && !(group === 'multipart' && 'kind' in row && row.kind === 'file'))
      secrets.push({ id, location, name: row.key });
    return value;
  });
  return secrets;
}

export async function inspectRestoredBackup(
  workspace: Workspace,
  checkFiles?: (paths: string[]) => Promise<(boolean | null)[]>,
) {
  const references = attachmentReferences(workspace);
  const paths = [...new Set(references.map(({ path }) => path).filter(Boolean))];
  const results = paths.length ? await checkFiles?.(paths).catch(() => undefined) : undefined;
  const availability = new Map(paths.map((path, index) => [path, results?.[index]]));
  return {
    attachments: references
      .filter(({ path }) => availability.get(path) !== true)
      .map((item) => ({
        ...item,
        unchecked: Boolean(item.path && availability.get(item.path) == null),
      })),
    secrets: emptySecrets(workspace),
  };
}

export type BackupRestoreReport = Awaited<ReturnType<typeof inspectRestoredBackup>>;
