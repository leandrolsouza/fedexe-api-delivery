import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  listLocalWorkspaces,
  readLocalWorkspace,
  removeLocalWorkspace,
  renameLocalWorkspace,
  originalWorkspaceId,
} from './local-workspaces';
import { createEmptyWorkspace, createWorkspace, STORAGE_KEY } from './models';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const id = 'a2123456-1234-4321-a123-b01234567890';
let storage: Map<string, string>;
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  storage = new Map();
  vi.stubGlobal('localStorage', {
    get length() {
      return storage.size;
    },
    key: (index: number) => [...storage.keys()][index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
it('removes browser workspace, selection and history without changing other workspaces or app preferences', async () => {
  storage.set(STORAGE_KEY, JSON.stringify(createEmptyWorkspace('Original')));
  storage.set(STORAGE_KEY + ':' + id, JSON.stringify(createEmptyWorkspace('Other')));
  storage.set('fedexe.active-workspace', id);
  storage.set('fedexe.workspace-opened:' + id, 'date');
  storage.set('fedexe.app-preferences', 'preferences');
  await removeLocalWorkspace(id, false);
  expect(await readLocalWorkspace(id, false)).toBeNull();
  expect(storage.has('fedexe.active-workspace')).toBe(false);
  expect(storage.has('fedexe.workspace-opened:' + id)).toBe(false);
  expect(storage.get('fedexe.app-preferences')).toBe('preferences');
  expect((await listLocalWorkspaces(false)).map((entry) => entry.id)).toEqual([
    originalWorkspaceId,
  ]);
});
it.each([false, true])(
  'does not resurrect a deleted original workspace (native=%s)',
  async (native) => {
    storage.set(STORAGE_KEY, JSON.stringify(createEmptyWorkspace('Original')));
    storage.set(STORAGE_KEY + ':' + id, JSON.stringify(createEmptyWorkspace('Other')));
    let original: string | null = storage.get(STORAGE_KEY)!;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'delete_workspace') original = null;
      if (command === 'load_workspace') return original;
      if (command === 'list_workspaces') return [{ id, name: 'Other' }];
    });
    await removeLocalWorkspace(originalWorkspaceId, native);
    expect(await readLocalWorkspace(originalWorkspaceId, native)).toBeNull();
    expect((await listLocalWorkspaces(native)).map((entry) => entry.id)).toEqual([id]);
    if (native) expect(invoke).toHaveBeenCalledWith('delete_workspace', { workspaceId: null });
  },
);
it('validates ids before removal and propagates native removal failures', async () => {
  await expect(removeLocalWorkspace('../workspace', true)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  vi.mocked(invoke).mockRejectedValue(new Error('locked'));
  await expect(removeLocalWorkspace(id, true)).rejects.toThrow('locked');
});

it.each([false, true])(
  'renames only the chosen workspace and preserves credential references and unknown fields (native=%s)',
  async (native) => {
    const [collection] = createWorkspace().collections;
    collection.folderPreRequests = {
      [collection.folders[0]]: ['pm.collectionVariables.set("ready", true);'],
    };
    const saved = {
      ...createEmptyWorkspace('Before'),
      collections: [collection],
      credentialSlots: ['logical-slot'],
      credentialRevisions: { 'logical-slot': 'private-revision' },
      retiredCredentials: [{ scope: 'revision', environment: '', variable: 'old-revision' }],
      futureField: { preserve: true },
    };
    saved.settings.defaultTimeoutMs = 9000;
    storage.set(STORAGE_KEY, 'unrelated-original');
    storage.set(STORAGE_KEY + ':' + id, JSON.stringify(saved));
    storage.set('fedexe.active-workspace', 'original');
    storage.set('fedexe.workspace-opened:' + id, 'unchanged-date');
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const options = args as { workspaceId: string; contents: string };
      if (command === 'load_workspace')
        return storage.get(STORAGE_KEY + ':' + options.workspaceId) ?? null;
      if (command === 'save_workspace')
        storage.set(STORAGE_KEY + ':' + options.workspaceId, options.contents);
    });
    expect(await renameLocalWorkspace(id, '  After  ', native)).toBe('After');
    expect(JSON.parse(storage.get(STORAGE_KEY + ':' + id)!)).toEqual({
      ...saved,
      settings: { ...saved.settings, workspaceName: 'After' },
    });
    expect(storage.get(STORAGE_KEY)).toBe('unrelated-original');
    expect(storage.get('fedexe.active-workspace')).toBe('original');
    expect(storage.get('fedexe.workspace-opened:' + id)).toBe('unchanged-date');
    if (native)
      expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
        'load_workspace',
        'save_workspace',
      ]);
  },
);
it('renames the original browser workspace and rejects blank, long, missing and damaged workspaces', async () => {
  const original = createEmptyWorkspace('Original');
  storage.set(STORAGE_KEY, JSON.stringify(original));
  await renameLocalWorkspace(originalWorkspaceId, 'Renamed', false);
  expect(JSON.parse(storage.get(STORAGE_KEY)!).settings.workspaceName).toBe('Renamed');
  await expect(renameLocalWorkspace(originalWorkspaceId, '  ', false)).rejects.toThrow();
  await expect(renameLocalWorkspace(originalWorkspaceId, 'a'.repeat(61), false)).rejects.toThrow();
  await expect(renameLocalWorkspace(id, 'Name', false)).rejects.toThrow();
  storage.set(STORAGE_KEY + ':' + id, '{broken');
  await expect(renameLocalWorkspace(id, 'Name', false)).rejects.toThrow();
  expect(storage.get(STORAGE_KEY + ':' + id)).toBe('{broken');
  await expect(renameLocalWorkspace('../workspace', 'Name', true)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
it('propagates native rename failures without claiming to update the stored name', async () => {
  const saved = JSON.stringify(createEmptyWorkspace('Before'));
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'load_workspace') return saved;
    throw new Error('locked');
  });
  await expect(renameLocalWorkspace(id, 'After', true)).rejects.toThrow('locked');
});
