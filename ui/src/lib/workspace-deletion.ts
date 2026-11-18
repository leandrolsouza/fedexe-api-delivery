import { workspaceSecretAddresses, writeSecret } from './credentials';
import { listLocalWorkspaces, readLocalWorkspace, removeLocalWorkspace } from './local-workspaces';
import { loadWorkspace } from './models';

export async function deleteWorkspaceData(id: string, native: boolean) {
  let cleanupError: unknown;
  let addresses: ReturnType<typeof workspaceSecretAddresses> | undefined;
  try {
    const raw = await readLocalWorkspace(id, native);
    addresses = raw === null ? new Map() : workspaceSecretAddresses(loadWorkspace(raw), native);
    for (const other of await listLocalWorkspaces(native)) {
      if (other.id === id) continue;
      const contents = await readLocalWorkspace(other.id, native);
      if (contents === null) continue;
      for (const key of workspaceSecretAddresses(loadWorkspace(contents), native).keys())
        addresses.delete(key);
    }
  } catch (error) {
    // A damaged workspace can still be removed. If ownership cannot be established,
    // preserve vault entries instead of risking another workspace's credentials.
    addresses = undefined;
    cleanupError = error;
  }
  await removeLocalWorkspace(id, native);
  for (const address of addresses?.values() ?? []) {
    try {
      await writeSecret(address, null, native);
    } catch (error) {
      cleanupError ??= error;
    }
  }
  return { cleanupError };
}
