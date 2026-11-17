import { invoke } from '@tauri-apps/api/core';
import { STORAGE_KEY } from './models';

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
  if (native) return [...workspaces, ...(await invoke<WorkspaceSummary[]>('list_workspaces'))];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(workspacePrefix)) continue;
    const id = key.slice(workspacePrefix.length);
    if (workspaceIdPattern.test(id))
      workspaces.push({ id, name: workspaceName(localStorage.getItem(key)) });
  }
  return workspaces;
}

export function lastActiveWorkspace() {
  try {
    return localStorage.getItem(activeKey) ?? originalWorkspaceId;
  } catch {
    return originalWorkspaceId;
  }
}

export function rememberActiveWorkspace(id: string) {
  localStorage.setItem(activeKey, id);
}
