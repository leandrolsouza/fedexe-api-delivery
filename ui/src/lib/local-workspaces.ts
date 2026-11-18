import { invoke } from '@tauri-apps/api/core';
import { STORAGE_KEY, loadWorkspace } from './models';
import { t } from './i18n';

export const originalWorkspaceId = 'original';
const activeKey = 'fedexe.active-workspace';
const workspacePrefix = STORAGE_KEY + ':';
const workspaceIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export type WorkspaceSummary = { id: string; name: string | null };

function storageKey(id: string) {
  return id === originalWorkspaceId ? STORAGE_KEY : workspacePrefix + id;
}

function workspaceName(raw: string | null): string | null {
  try {
    const name: unknown = raw && JSON.parse(raw)?.settings?.workspaceName;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

export async function readLocalWorkspace(id: string, native: boolean) {
  if (!native) return localStorage.getItem(storageKey(id));
  const raw = await invoke<string | null>('load_workspace', {
    workspaceId: id === originalWorkspaceId ? null : id,
  });
  return id === originalWorkspaceId ? (raw ?? localStorage.getItem(STORAGE_KEY)) : raw;
}

export async function writeLocalWorkspace(id: string, contents: string, native: boolean) {
  if (native) {
    await invoke('save_workspace', {
      workspaceId: id === originalWorkspaceId ? null : id,
      contents,
    });
  } else {
    localStorage.setItem(storageKey(id), contents);
  }
}

export async function listLocalWorkspaces(native: boolean): Promise<WorkspaceSummary[]> {
  const original = await readLocalWorkspace(originalWorkspaceId, native).catch(() => null);
  const workspaces = [{ id: originalWorkspaceId, name: workspaceName(original) }];
  if (native) {
    const additional = await invoke<WorkspaceSummary[]>('list_workspaces');
    return original === null && additional.length ? additional : [...workspaces, ...additional];
  }
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(workspacePrefix)) continue;
    const id = key.slice(workspacePrefix.length);
    if (workspaceIdPattern.test(id))
      workspaces.push({ id, name: workspaceName(localStorage.getItem(key)) });
  }
  return original === null && workspaces.length > 1 ? workspaces.slice(1) : workspaces;
}

export function lastActiveWorkspace() {
  try {
    return localStorage.getItem(activeKey) ?? originalWorkspaceId;
  } catch {
    return originalWorkspaceId;
  }
}

export function workspaceLastOpened(id: string): string | undefined {
  try {
    return localStorage.getItem('fedexe.workspace-opened:' + id) ?? undefined;
  } catch {
    return undefined;
  }
}
export function rememberActiveWorkspace(id: string) {
  localStorage.setItem('fedexe.workspace-opened:' + id, new Date().toISOString());
  localStorage.setItem(activeKey, id);
}

export async function removeLocalWorkspace(id: string, native: boolean) {
  if (id !== originalWorkspaceId && !workspaceIdPattern.test(id))
    throw new Error('Invalid workspace identifier');
  // Remove the legacy browser fallback before deleting the native original file.
  // If removal fails, the saved desktop workspace remains available.
  if (!native || id === originalWorkspaceId) localStorage.removeItem(storageKey(id));
  if (native)
    await invoke('delete_workspace', { workspaceId: id === originalWorkspaceId ? null : id });
  try {
    localStorage.removeItem('fedexe.workspace-opened:' + id);
    if (localStorage.getItem(activeKey) === id) localStorage.removeItem(activeKey);
  } catch {
    /* Access history must not turn a completed deletion into a failure. */
  }
}

export async function renameLocalWorkspace(id: string, name: string, native: boolean) {
  if (id !== originalWorkspaceId && !workspaceIdPattern.test(id))
    throw new Error(t('Identificador de workspace inválido.'));
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) throw new Error(t('Informe um nome de até 60 caracteres.'));
  const raw = await readLocalWorkspace(id, native);
  if (raw === null) throw new Error(t('O workspace selecionado não foi encontrado.'));
  // Preserve credential references and all existing fields; renaming never hydrates secrets.
  const workspace = loadWorkspace(raw);
  await writeLocalWorkspace(
    id,
    JSON.stringify({
      ...workspace,
      settings: { ...workspace.settings, workspaceName: trimmed },
    }),
    native,
  );
  return trimmed;
}
