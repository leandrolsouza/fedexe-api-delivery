import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSecrets } from './credentials';
import { createWorkspaceAutosave } from './workspace-autosave';
import { createWorkspace, loadWorkspace, pair } from './models';

const vault = vi.hoisted(() => new Map<string, string>());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command, { scope, environment, variable, value }) => {
    const key = JSON.stringify([scope, environment, variable]);
    if (command === 'read_secret') return vault.get(key) ?? null;
    if (value === null) vault.delete(key);
    else vault.set(key, value);
  }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vault.clear();
  const session = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => session.set(key, value),
    removeItem: (key: string) => session.delete(key),
  });
});

describe('persistência de credenciais do workspace', () => {
  it.each([true, false])(
    'migra credenciais v1 e recupera os valores após recarregar (desktop=%s)',
    async (native) => {
      const original = createWorkspace();
      const collection = original.collections[0];
      const request = collection.requests[0];
      const environment = original.environments[0];
      collection.auth = {
        ...collection.auth,
        type: 'basic',
        username: 'usuario',
        password: 'senha-antiga',
      };
      collection.variables.push({ ...pair('privado', 'variavel-antiga'), secret: true });
      request.auth = { ...request.auth, type: 'bearer', token: 'bearer-antigo' };
      request.headers.push(pair('X-API-Key', 'chave-antiga'));
      request.url += '?access_token=token-na-url';
      environment.variables.push({
        ...pair('private', native ? '' : 'token-antigo'),
        secret: true,
      });
      if (native) {
        const variable = environment.variables.at(-1)!;
        vault.set(JSON.stringify(['environment', environment.id, variable.id]), 'token-antigo');
      }

      const loaded = await loadSecrets(loadWorkspace(JSON.stringify(original)), native);
      let contents = '';
      const save = async (serialized: string) => {
        contents = serialized;
      };
      const autosave = createWorkspaceAutosave({ ...loaded, native, writeWorkspace: save });
      await autosave.enqueue(loaded.workspace).result;

      for (const value of [
        'senha-antiga',
        'variavel-antiga',
        'bearer-antigo',
        'chave-antiga',
        'token-na-url',
        'token-antigo',
      ])
        expect(contents).not.toContain(value);
      expect((await loadSecrets(loadWorkspace(contents), native)).workspace).toEqual(
        loaded.workspace,
      );

      const updated = loaded.workspace.collections[0].requests[0];
      updated.auth.token = '';
      await autosave.enqueue(loaded.workspace).result;
      const reopened = await loadSecrets(loadWorkspace(contents), native);
      expect(reopened.workspace.collections[0].requests[0].auth.token).toBe('');
      expect([...reopened.storedSecrets.values()].map(({ value }) => value)).not.toContain(
        'bearer-antigo',
      );
    },
  );

  it('mantém o JSON anterior se a gravação no cofre falhar e permite tentar novamente', async () => {
    const workspace = createWorkspace();
    workspace.collections[0].auth.password = 'senha-a-migrar';
    const loaded = await loadSecrets(workspace, false);
    const save = vi.fn(async () => {});
    vi.spyOn(sessionStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('Falha simulada');
    });
    const autosave = createWorkspaceAutosave({ ...loaded, native: false, writeWorkspace: save });
    await expect(autosave.enqueue(loaded.workspace).result).rejects.toThrow('Falha simulada');
    expect(save).not.toHaveBeenCalled();
    await autosave.enqueue(loaded.workspace).result;
    expect(save).toHaveBeenCalledOnce();
  });
});

async function savedWorkspace() {
  const workspace = createWorkspace();
  const auth = workspace.collections[0].auth;
  auth.password = 'senha-original';
  auth.token = 'token-original';
  let contents = '';
  const writeWorkspace = vi.fn(async (serialized: string) => {
    contents = serialized;
  });
  const autosave = createWorkspaceAutosave({
    native: true,
    storedSecrets: new Map(),
    retiredSecrets: [],
    writeWorkspace,
  });
  await autosave.enqueue(workspace).result;
  writeWorkspace.mockClear();
  return {
    autosave,
    workspace,
    writeWorkspace,
    reopen: async () => loadSecrets(loadWorkspace(contents), true),
    contents: () => contents,
  };
}

describe('autosave do workspace', () => {
  it('reabre o JSON anterior com as credenciais anteriores quando o segundo segredo falha', async () => {
    const { autosave, workspace, reopen, writeWorkspace, contents } = await savedWorkspace();
    const oldContents = contents();
    const changed = structuredClone(workspace);
    changed.settings.workspaceName = 'Nome novo';
    changed.collections[0].auth.token = 'token-novo';
    changed.collections[0].auth.password = 'senha-nova';
    const set = vault.set.bind(vault);
    vi.spyOn(vault, 'set')
      .mockImplementationOnce(set)
      .mockImplementationOnce(() => {
        throw new Error('Cofre indisponível');
      });

    await expect(autosave.enqueue(changed).result).rejects.toThrow('Cofre indisponível');
    expect(writeWorkspace).not.toHaveBeenCalled();
    expect(contents()).toBe(oldContents);
    expect(vault.size).toBe(3);
    expect((await reopen()).workspace).toEqual(workspace);

    await autosave.enqueue(changed).result;
    expect((await reopen()).workspace).toEqual(changed);
    expect([...vault.values()].sort()).toEqual(['senha-nova', 'token-novo']);
  });

  it('mantém a versão anterior após falha do JSON e reaproveita a credencial na nova tentativa', async () => {
    const { autosave, workspace, reopen, writeWorkspace, contents } = await savedWorkspace();
    const oldContents = contents();
    const changed = structuredClone(workspace);
    changed.settings.workspaceName = 'Nome novo';
    changed.collections[0].auth.password = 'senha-nova';
    changed.collections[0].auth.token = '';
    writeWorkspace.mockRejectedValueOnce(new Error('Disco cheio'));

    await expect(autosave.enqueue(changed).result).rejects.toThrow('Disco cheio');
    expect(contents()).toBe(oldContents);
    expect((await reopen()).workspace).toEqual(workspace);

    const writeSecret = vi.spyOn(vault, 'set');
    await autosave.enqueue(changed).result;
    expect(writeSecret).not.toHaveBeenCalled();
    expect((await reopen()).workspace).toEqual(changed);
    expect([...vault.values()]).toEqual(['senha-nova']);
    expect(contents()).not.toContain('senha-nova');
  });

  it('preserva o JSON confirmado se a limpeza falhar e retoma a limpeza depois de reabrir', async () => {
    const { autosave, workspace, reopen, writeWorkspace, contents } = await savedWorkspace();
    const changed = structuredClone(workspace);
    changed.collections[0].auth.password = 'senha-confirmada';
    vi.spyOn(vault, 'delete').mockImplementationOnce(() => {
      throw new Error('Falha ao excluir');
    });

    const saved = await autosave.enqueue(changed).result;
    expect(saved?.cleanupError).toEqual(new Error('Falha ao excluir'));
    expect([...vault.values()]).toContain('senha-original');
    const reopened = await reopen();
    expect(reopened.workspace).toEqual(changed);
    expect(reopened.retiredSecrets).toHaveLength(1);

    const restarted = createWorkspaceAutosave({ ...reopened, native: true, writeWorkspace });
    expect((await restarted.enqueue(reopened.workspace).result)?.cleanupError).toBeUndefined();
    expect([...vault.values()]).not.toContain('senha-original');
    expect((await reopen()).workspace).toEqual(changed);
    expect(contents()).not.toContain('senha-confirmada');
  });

  it('não descarta a credencial quando o JSON foi gravado mas faltou a confirmação', async () => {
    const { autosave, workspace, reopen, writeWorkspace } = await savedWorkspace();
    const changed = structuredClone(workspace);
    changed.collections[0].auth.password = 'senha-confirmada';
    const persist = writeWorkspace.getMockImplementation()!;
    writeWorkspace.mockImplementationOnce(async (contents) => {
      await persist(contents);
      throw new Error('Confirmação interrompida');
    });

    await expect(autosave.enqueue(changed).result).rejects.toThrow('Confirmação interrompida');
    expect((await reopen()).workspace).toEqual(changed);
    await autosave.enqueue(changed).result;
    expect((await reopen()).workspace).toEqual(changed);
    expect([...vault.values()].sort()).toEqual(['senha-confirmada', 'token-original']);
  });

  it('impede regravar um workspace cuja credencial confirmada está ausente', async () => {
    const { reopen, writeWorkspace } = await savedWorkspace();
    vault.clear();

    await expect(reopen()).rejects.toThrow('Windows Credential Manager');
    expect(writeWorkspace).not.toHaveBeenCalled();
  });

  it('serializa as gravações e pula um workspace substituído enquanto estava na fila', async () => {
    const { autosave, workspace, reopen, writeWorkspace } = await savedWorkspace();
    const first = structuredClone(workspace);
    const obsolete = structuredClone(workspace);
    const latest = structuredClone(workspace);
    first.settings.workspaceName = 'Primeiro';
    obsolete.settings.workspaceName = 'Substituído';
    latest.settings.workspaceName = 'Atual';

    let markStarted!: () => void;
    let rejectSave!: (error: Error) => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const failure = new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    });
    writeWorkspace.mockImplementationOnce(async () => {
      markStarted();
      return failure;
    });
    const firstSave = autosave.enqueue(first);
    await started;
    const cancelled = autosave.enqueue(obsolete);
    const lastSave = autosave.enqueue(latest);
    cancelled.cancel();

    expect(writeWorkspace).toHaveBeenCalledOnce();
    rejectSave(new Error('Falha inicial'));
    await expect(firstSave.result).rejects.toThrow('Falha inicial');
    await expect(cancelled.result).resolves.toBeUndefined();
    await lastSave.result;
    expect(writeWorkspace).toHaveBeenCalledTimes(2);
    expect((await reopen()).workspace).toEqual(latest);
  });
});
