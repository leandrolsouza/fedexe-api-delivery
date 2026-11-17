import { expect, it, vi } from 'vitest';
import { inspectRestoredBackup, replaceBackupAttachment } from './backup-restore';
import { createWorkspace, exportableWorkspace, newRequest, pair } from './models';

it('reports an unavailable binary and targets only the selected multipart file', async () => {
  const workspace = createWorkspace();
  const binary = { ...newRequest(), bodyType: 'binary' as const, binaryFile: 'C:/gone.txt' };
  const missingPart = { ...pair('upload', ''), kind: 'file' as const };
  const existingPart = { ...pair('existing', 'C:/existing.txt'), kind: 'file' as const };
  const disabledPart = { ...pair('disabled', ''), kind: 'file' as const, enabled: false };
  const multipart = {
    ...newRequest(),
    bodyType: 'multipart' as const,
    multipart: [missingPart, existingPart, disabledPart],
  };
  workspace.collections[0].requests = [binary, multipart];
  const checkFiles = vi.fn(async () => [false, true]);
  const { attachments } = await inspectRestoredBackup(workspace, checkFiles);

  expect(checkFiles).toHaveBeenCalledWith(['C:/gone.txt', 'C:/existing.txt']);
  expect(attachments).toMatchObject([
    { requestId: binary.id, path: 'C:/gone.txt', unchecked: false },
    { requestId: multipart.id, partId: missingPart.id, path: '', unchecked: false },
  ]);
  expect(replaceBackupAttachment(multipart, attachments[1], 'C:/new.txt').multipart).toEqual([
    { ...missingPart, value: 'C:/new.txt' },
    existingPart,
    disabledPart,
  ]);
  const unchecked = await inspectRestoredBackup(workspace);
  expect(unchecked.attachments[0].unchecked).toBe(true);
});

it('identifies empty secret fields without including values or valid references', async () => {
  const workspace = createWorkspace();
  const collection = workspace.collections[0];
  const environment = workspace.environments[0];
  environment.variables.push(
    { ...pair('session_token', 'fixture-secret'), secret: true },
    pair('public', ''),
  );
  const request = newRequest();
  request.name = 'Upload';
  request.auth = { ...request.auth, type: 'bearer', token: '{{session_token}}' };
  request.headers.push(pair('X-API-Key', 'fixture-header'));
  collection.requests = [request];
  const { secrets } = await inspectRestoredBackup(exportableWorkspace(workspace));

  expect(secrets).toMatchObject([
    { location: environment.name, name: 'session_token' },
    { location: `${collection.name} / Upload`, name: 'X-API-Key' },
  ]);
  expect(JSON.stringify(secrets)).not.toContain('fixture-');
});
