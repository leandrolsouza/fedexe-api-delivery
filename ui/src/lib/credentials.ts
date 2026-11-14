import { invoke } from '@tauri-apps/api/core';
import type { Workspace } from './models';

type Secret = { environment: string; variable: string; value: string };

function workspaceSecrets(workspace: Workspace) {
  return workspace.environments.flatMap(({ id, variables }) =>
    variables
      .filter((variable) => variable.secret)
      .map((variable) => ({ environment: id, variable: variable.id, value: variable.value })),
  );
}

const secretKey = ({ environment, variable }: Secret) => JSON.stringify([environment, variable]);

export async function loadSecrets(workspace: Workspace) {
  for (const environment of workspace.environments) {
    for (const variable of environment.variables) {
      if (variable.secret) {
        variable.value =
          (await invoke<string | null>('read_secret', {
            environment: environment.id,
            variable: variable.id,
          })) ?? '';
      }
    }
  }
}

export function secretSnapshot(workspace: Workspace) {
  return new Map(workspaceSecrets(workspace).map((secret) => [secretKey(secret), secret]));
}

export async function saveSecrets(
  saved: Map<string, Secret>,
  next: Map<string, Secret>,
  saveWorkspace: () => Promise<void>,
) {
  for (const [key, secret] of next) {
    if (!secret.value || saved.get(key)?.value === secret.value) continue;
    await invoke('write_secret', secret);
    saved.set(key, secret);
  }
  await saveWorkspace();
  for (const [key, secret] of saved) {
    if (next.get(key)?.value) continue;
    await invoke('write_secret', { ...secret, value: null });
    saved.delete(key);
  }
}
