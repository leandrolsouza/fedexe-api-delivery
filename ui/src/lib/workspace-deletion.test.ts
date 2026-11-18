import { beforeEach, expect, it, vi } from 'vitest';
import { deleteWorkspaceData } from './workspace-deletion';
import { createEmptyWorkspace, pair } from './models';
import { secretKey, revisionAddress, writeSecret } from './credentials';
import { listLocalWorkspaces, readLocalWorkspace, removeLocalWorkspace } from './local-workspaces';
vi.mock('./local-workspaces', () => ({
  listLocalWorkspaces: vi.fn(),
  readLocalWorkspace: vi.fn(),
  removeLocalWorkspace: vi.fn(),
}));
vi.mock('./credentials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./credentials')>()),
  writeSecret: vi.fn(),
}));
const legacy = { scope: 'environment' as const, environment: 'environment', variable: 'token' };
function savedWorkspace(revision: string) {
  const workspace = createEmptyWorkspace('Private');
  workspace.environments.push({
    id: 'environment',
    name: 'Environment',
    color: 'purple',
    variables: [{ ...pair('token', ''), id: 'token', secret: true }],
  });
  workspace.credentialSlots = [secretKey(legacy)];
  workspace.credentialRevisions = { [secretKey(legacy)]: revision };
  return workspace;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listLocalWorkspaces).mockResolvedValue([
    { id: 'target', name: 'Target' },
    { id: 'other', name: 'Other' },
  ]);
  vi.mocked(removeLocalWorkspace).mockResolvedValue(undefined);
  vi.mocked(writeSecret).mockResolvedValue(undefined);
});
it.each([false, true])(
  'cleans only credentials owned by the deleted workspace after deleting its data (native=%s)',
  async (native) => {
    const target = savedWorkspace('private-revision');
    target.retiredCredentials = [revisionAddress('shared-revision'), legacy];
    const other = savedWorkspace('shared-revision');
    vi.mocked(readLocalWorkspace).mockImplementation(async (id) =>
      JSON.stringify(id === 'target' ? target : other),
    );
    expect((await deleteWorkspaceData('target', native)).cleanupError).toBeUndefined();
    expect(removeLocalWorkspace).toHaveBeenCalledWith('target', native);
    expect(writeSecret).toHaveBeenCalledWith(revisionAddress('private-revision'), null, native);
    expect(writeSecret).toHaveBeenCalledWith(legacy, null, native);
    expect(writeSecret).toHaveBeenCalledTimes(2);
    expect(vi.mocked(removeLocalWorkspace).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(writeSecret).mock.invocationCallOrder[0],
    );
  },
);
it('does not remove credentials if deleting the workspace fails', async () => {
  vi.mocked(readLocalWorkspace).mockResolvedValue(JSON.stringify(savedWorkspace('private')));
  vi.mocked(removeLocalWorkspace).mockRejectedValue(new Error('locked'));
  await expect(deleteWorkspaceData('target', true)).rejects.toThrow('locked');
  expect(writeSecret).not.toHaveBeenCalled();
});
it('removes damaged workspaces while preserving credentials when their ownership cannot be established', async () => {
  vi.mocked(readLocalWorkspace).mockResolvedValue('{broken');
  expect((await deleteWorkspaceData('target', true)).cleanupError).toBeDefined();
  expect(removeLocalWorkspace).toHaveBeenCalledWith('target', true);
  expect(writeSecret).not.toHaveBeenCalled();
});
it('reports credential cleanup failure after the workspace was deleted', async () => {
  vi.mocked(listLocalWorkspaces).mockResolvedValue([{ id: 'target', name: 'Target' }]);
  vi.mocked(readLocalWorkspace).mockResolvedValue(JSON.stringify(savedWorkspace('private')));
  vi.mocked(writeSecret).mockRejectedValue(new Error('vault unavailable'));
  expect((await deleteWorkspaceData('target', true)).cleanupError).toBeInstanceOf(Error);
  expect(removeLocalWorkspace).toHaveBeenCalledWith('target', true);
});
