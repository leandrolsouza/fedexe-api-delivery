import { loadSecrets, prepareSecrets, revisionAddress, writeSecret } from './credentials';
import { readLocalWorkspace, writeLocalWorkspace } from './local-workspaces';
import { loadWorkspace, type CredentialAddress } from './models';
import { uid } from './utils';
import { t } from './i18n';

export async function duplicateLocalWorkspace(sourceId: string, name: string, native: boolean) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) throw new Error(t('Informe um nome de até 60 caracteres.'));
  const raw = await readLocalWorkspace(sourceId, native);
  if (raw === null) throw new Error(t('O workspace selecionado não foi encontrado.'));
  const { workspace } = await loadSecrets(loadWorkspace(raw), native);
  const { sanitized, values } = prepareSecrets(workspace);
  const id = uid();
  const revisions: Record<string, string> = {};
  const staged: CredentialAddress[] = [];
  try {
    for (const [key, value] of values) {
      const address = revisionAddress(uid());
      staged.push(address);
      await writeSecret(address, value, native);
      revisions[key] = address.variable;
    }
    await writeLocalWorkspace(
      id,
      JSON.stringify({
        ...sanitized,
        settings: { ...sanitized.settings, workspaceName: trimmed },
        credentialSlots: [...values.keys()],
        credentialRevisions: revisions,
        retiredCredentials: [],
      }),
      native,
    );
  } catch (error) {
    let cleanupFailed = false;
    for (const address of staged) {
      try {
        await writeSecret(address, null, native);
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed)
      throw new Error(
        t('A cópia não foi salva e não foi possível concluir a limpeza das novas credenciais.'),
      );
    throw error;
  }
  return { id, name: trimmed };
}
