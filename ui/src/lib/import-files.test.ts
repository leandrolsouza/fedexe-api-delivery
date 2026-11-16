import { describe, expect, it, vi } from 'vitest';
import { importDocument, importFileBatch } from './import-files';
import { createWorkspace } from './models';

const file = (name: string, contents: unknown) =>
  new File([JSON.stringify(contents)], name, { type: 'application/json' });

describe('importação de arquivos em lote', () => {
  it('importa coleções e ambientes válidos mesmo quando outros arquivos falham', async () => {
    const result = await importFileBatch([
      file('coleção.json', {
        info: {
          name: 'API local',
          schema: 'https://schema.postman.com/json/collection/v2.1.0/collection.json',
        },
        event: [{ listen: 'prerequest', script: { exec: ['pm.variables.set("ready", true);'] } }],
        item: [{ name: 'Health', request: 'https://example.test/health' }],
      }),
      new File(['{'], 'inválido.json'),
      file('backup.json', createWorkspace()),
      file('ambiente.json', { _postman_variable_scope: 'environment', name: 'Local', values: [] }),
    ]);

    expect(result.succeeded).toBe(2);
    expect(result.collections[0].scripts?.before).toBe('pm.variables.set("ready", true);');
    expect(result.environments.map(({ name }) => name)).toEqual(['Local']);
    expect(result.entries).toEqual([
      'coleção.json: imported API local.',
      'ambiente.json: imported Local.',
    ]);
    expect(result.issues).toEqual([
      expect.stringMatching(/^inválido\.json:/),
      expect.stringContaining('backup.json: Select the backup on its own'),
    ]);
  });

  it('aplica o limite por arquivo e mantém a leitura individual de backups', async () => {
    const read = vi.fn();
    const result = await importFileBatch([
      { name: 'grande.json', size: 10 * 1024 * 1024 + 1, text: read },
      {
        name: 'indisponível.json',
        size: 1,
        text: async () => {
          throw new Error('read failed');
        },
      },
    ]);
    expect(read).not.toHaveBeenCalled();
    expect(result.succeeded).toBe(0);
    expect(result.issues).toEqual([
      'grande.json: The file exceeds the 10 MB import limit.',
      'indisponível.json: read failed',
    ]);
    expect(importDocument(JSON.stringify(createWorkspace())).kind).toBe('backup');
  });
});
