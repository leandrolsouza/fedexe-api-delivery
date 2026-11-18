import { beforeEach, expect, it, vi } from 'vitest';
import { duplicateLocalWorkspace } from './workspace-duplication';
import { createWorkspace, loadWorkspace, pair, STORAGE_KEY } from './models';
import { loadSecrets, secretKey } from './credentials';
import { createWorkspaceAutosave } from './workspace-autosave';
import { readLocalWorkspace, listLocalWorkspaces } from './local-workspaces';
import { deleteWorkspaceData } from './workspace-deletion';

const nativeData = vi.hoisted(() => ({
  files: new Map<string, string>(),
  vault: new Map<string, string>(),
  failSave: false,
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command, args) => {
    const id = args?.workspaceId ?? 'original';
    if (command === 'load_workspace') return nativeData.files.get(id) ?? null;
    if (command === 'save_workspace') {
      if (nativeData.failSave) throw new Error('locked');
      nativeData.files.set(id, args.contents);
      return;
    }
    if (command === 'delete_workspace') {
      nativeData.files.delete(id);
      return;
    }
    if (command === 'list_workspaces')
      return [...nativeData.files]
        .filter(([id]) => id !== 'original')
        .map(([id, raw]) => ({ id, name: JSON.parse(raw).settings.workspaceName }));
    const key = secretKey(args);
    if (command === 'read_secret') return nativeData.vault.get(key) ?? null;
    if (command === 'write_secret') {
      if (args.value === null) nativeData.vault.delete(key);
      else nativeData.vault.set(key, args.value);
    }
  }),
}));
let local: Map<string, string>;
let session: Map<string, string>;
let failBrowserSave: boolean;
beforeEach(() => {
  nativeData.files.clear();
  nativeData.vault.clear();
  nativeData.failSave = false;
  local = new Map();
  session = new Map();
  failBrowserSave = false;
  vi.stubGlobal('localStorage', {
    get length() {
      return local.size;
    },
    key: (index: number) => [...local.keys()][index] ?? null,
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failBrowserSave && key.startsWith(STORAGE_KEY)) throw new Error('quota');
      local.set(key, value);
    },
    removeItem: (key: string) => local.delete(key),
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => session.set(key, value),
    removeItem: (key: string) => session.delete(key),
  });
});
async function saveSource(native: boolean) {
  const source = createWorkspace();
  source.settings.workspaceName = 'Source';
  source.environments[0].variables.push({
    ...pair('private', 'private-environment-token'),
    secret: true,
  });
  source.collections[0].auth = {
    ...source.collections[0].auth,
    type: 'bearer',
    token: 'private-auth-token',
  };
  source.settings.defaultTimeoutMs = 9000;
  await createWorkspaceAutosave({ native, storedSecrets: new Map(), retiredSecrets: [] }).enqueue(
    source,
  ).result;
  return source;
}
it.each([false, true])(
  'duplicates the saved workspace with independent credentials and survives source deletion (native=%s)',
  async (native) => {
    const source = await saveSource(native);
    const original = await readLocalWorkspace('original', native);
    const copy = await duplicateLocalWorkspace('original', '  Copy  ', native);
    expect(copy.id).not.toBe('original');
    expect(copy.name).toBe('Copy');
    const raw = (await readLocalWorkspace(copy.id, native))!;
    expect(raw).not.toContain('private-environment-token');
    expect(raw).not.toContain('private-auth-token');
    const saved = loadWorkspace(raw);
    const originalSaved = loadWorkspace(original);
    expect(saved.credentialRevisions).not.toEqual(originalSaved.credentialRevisions);
    expect(saved.retiredCredentials).toEqual([]);
    const hydrated = (await loadSecrets(saved, native)).workspace;
    expect(hydrated).toEqual({
      ...source,
      settings: { ...source.settings, workspaceName: 'Copy' },
    });
    expect(await readLocalWorkspace('original', native)).toBe(original);
    expect((await listLocalWorkspaces(native)).map((entry) => entry.id)).toContain(copy.id);
    await deleteWorkspaceData('original', native);
    const reloaded = await loadSecrets(
      loadWorkspace(await readLocalWorkspace(copy.id, native)),
      native,
    );
    expect(reloaded.workspace.collections[0].auth.token).toBe('private-auth-token');
    expect(reloaded.workspace.environments[0].variables.at(-1)?.value).toBe(
      'private-environment-token',
    );
  },
);
it.each([false, true])(
  'cleans staged credentials when saving the copy fails and leaves the source intact (native=%s)',
  async (native) => {
    await saveSource(native);
    const original = await readLocalWorkspace('original', native);
    const credentials = new Map(native ? nativeData.vault : session);
    nativeData.failSave = true;
    failBrowserSave = true;
    await expect(duplicateLocalWorkspace('original', 'Copy', native)).rejects.toThrow();
    expect(native ? nativeData.vault : session).toEqual(credentials);
    expect(await readLocalWorkspace('original', native)).toBe(original);
    expect(await listLocalWorkspaces(native)).toHaveLength(1);
  },
);
it('rejects empty or oversized names and missing or damaged sources without creating a copy', async () => {
  await expect(duplicateLocalWorkspace('original', ' ', false)).rejects.toThrow();
  await expect(duplicateLocalWorkspace('original', 'x'.repeat(61), false)).rejects.toThrow();
  await expect(duplicateLocalWorkspace('original', 'Copy', false)).rejects.toThrow();
  local.set(STORAGE_KEY, '{broken');
  await expect(duplicateLocalWorkspace('original', 'Copy', false)).rejects.toThrow();
  expect(local).toEqual(new Map([[STORAGE_KEY, '{broken']]));
  expect(session.size).toBe(0);
});
