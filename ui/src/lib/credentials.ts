import { invoke } from '@tauri-apps/api/core';
import { t } from './i18n';
import { mapWorkspaceCredentials, type CredentialAddress, type Workspace } from './models';

export type StoredSecret = { address: CredentialAddress; value: string };
export type StoredSecrets = Map<string, StoredSecret>;

const sessionPrefix = 'fedexe.credential.v1:';

function address(
  scope: 'environment' | 'collection',
  environment: string,
  field: string[],
): CredentialAddress {
  return {
    scope,
    environment,
    variable: scope === 'environment' ? field[0] : JSON.stringify(field),
  };
}

export function revisionAddress(revision: string): CredentialAddress {
  return { scope: 'revision', environment: '', variable: revision };
}

export function secretKey({ scope, environment, variable }: CredentialAddress) {
  return JSON.stringify([scope, environment, variable]);
}

async function readSecret(secret: CredentialAddress, native: boolean) {
  return native
    ? invoke<string | null>('read_secret', secret)
    : sessionStorage.getItem(sessionPrefix + secretKey(secret));
}

export async function writeSecret(
  secret: CredentialAddress,
  value: string | null,
  native: boolean,
) {
  if (native) {
    await invoke('write_secret', { ...secret, value });
  } else {
    const key = sessionPrefix + secretKey(secret);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  }
}

export async function loadSecrets(workspace: Workspace, native: boolean) {
  const storedSecrets: StoredSecrets = new Map();
  const savedSlots = workspace.credentialSlots && new Set(workspace.credentialSlots);
  const reads = new Map<string, CredentialAddress>();
  mapWorkspaceCredentials(workspace, (scope, owner, field, value, publicValue) => {
    const legacyAddress = address(scope, owner, field);
    const key = secretKey(legacyAddress);
    if (
      value === publicValue &&
      (savedSlots ? savedSlots.has(key) : native && scope === 'environment')
    ) {
      const revision = workspace.credentialRevisions?.[key];
      reads.set(key, revision === undefined ? legacyAddress : revisionAddress(revision));
    }
    return value;
  });
  for (const [key, location] of reads) {
    const value = await readSecret(location, native);
    if (value === null && native && savedSlots?.has(key))
      throw new Error(t('Uma credencial do workspace não está disponível no cofre do Windows.'));
    if (value !== null) storedSecrets.set(key, { address: location, value });
  }
  const hydrated = mapWorkspaceCredentials(workspace, (scope, owner, field, value) => {
    return storedSecrets.get(secretKey(address(scope, owner, field)))?.value ?? value;
  });
  return { workspace: hydrated, storedSecrets, retiredSecrets: workspace.retiredCredentials ?? [] };
}

export function prepareSecrets(workspace: Workspace) {
  const values = new Map<string, string>();
  const sanitized = mapWorkspaceCredentials(
    workspace,
    (scope, owner, field, value, publicValue) => {
      if (value !== publicValue) values.set(secretKey(address(scope, owner, field)), value);
      return publicValue;
    },
  );
  return { sanitized, values };
}
