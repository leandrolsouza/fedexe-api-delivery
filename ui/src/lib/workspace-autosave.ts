import { invoke } from '@tauri-apps/api/core';
import {
  prepareSecrets,
  revisionAddress,
  secretKey,
  writeSecret,
  type StoredSecrets,
} from './credentials';
import { STORAGE_KEY, type CredentialAddress, type Workspace } from './models';
import { uid } from './utils';

type SaveResult = { cleanupError?: unknown };
type Options = {
  native: boolean;
  storedSecrets: StoredSecrets;
  retiredSecrets: CredentialAddress[];
  writeWorkspace?: (contents: string) => Promise<void>;
};

export function createWorkspaceAutosave({
  native,
  storedSecrets,
  retiredSecrets,
  writeWorkspace,
}: Options) {
  const persist =
    writeWorkspace ??
    (async (contents: string) => {
      if (native) await invoke('save_workspace', { contents });
      else localStorage.setItem(STORAGE_KEY, contents);
    });
  let committed = storedSecrets;
  const staged: StoredSecrets = new Map();
  let retired = new Map(retiredSecrets.map((address) => [secretKey(address), address]));
  let queue = Promise.resolve();

  async function save(workspace: Workspace): Promise<SaveResult> {
    const { sanitized, values } = prepareSecrets(workspace);
    const next: StoredSecrets = new Map();
    for (const [key, value] of values) {
      const previous = committed.get(key);
      const pending = staged.get(key);
      if (previous?.value === value) {
        next.set(key, previous);
      } else if (pending?.value === value) {
        next.set(key, pending);
      } else {
        const address = revisionAddress(uid());
        // Keep every attempted address until a successful JSON write establishes which ones are live.
        retired.set(secretKey(address), address);
        await writeSecret(address, value, native);
        const secret = { address, value };
        staged.set(key, secret);
        next.set(key, secret);
      }
    }

    const garbage = new Map(retired);
    for (const { address } of committed.values()) garbage.set(secretKey(address), address);
    for (const { address } of next.values()) garbage.delete(secretKey(address));
    const revisions = [...next].flatMap(([key, { address }]) =>
      address.scope === 'revision' ? [[key, address.variable] as const] : [],
    );

    // Until this atomic write succeeds, the previous JSON still has all of its credentials.
    await persist(
      JSON.stringify({
        ...sanitized,
        credentialSlots: [...next.keys()],
        credentialRevisions: Object.fromEntries(revisions),
        retiredCredentials: [...garbage.values()],
      }),
    );
    committed = next;
    staged.clear();
    retired = garbage;

    let cleanupError: unknown;
    for (const [key, address] of retired) {
      try {
        await writeSecret(address, null, native);
        retired.delete(key);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (native && !writeWorkspace) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    return { cleanupError };
  }

  return {
    enqueue(workspace: Workspace) {
      let cancelled = false;
      const result = queue.then(() => (cancelled ? undefined : save(workspace)));
      queue = result.then(
        () => {},
        () => {},
      );
      return {
        result,
        cancel: () => {
          cancelled = true;
        },
      };
    },
  };
}
