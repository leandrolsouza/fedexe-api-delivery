import { stat, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const [installer] = process.argv.slice(2);
const { version } = JSON.parse(await readFile('tauri.conf.json', 'utf8'));
if (!installer || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error('Informe um instalador de uma versão estável.');
}
const name = basename(installer);
if (!name.endsWith(`_${version}_x64-setup.exe`) || !/^[a-zA-Z0-9._-]+$/.test(name)) {
  throw new Error('O manifesto requer o instalador NSIS x64 da versão configurada.');
}
if (!(await stat(installer)).isFile()) throw new Error('O instalador precisa ser um arquivo.');
const signature = (await readFile(`${installer}.sig`, 'utf8')).trim();
if (!signature) throw new Error('A assinatura do instalador está vazia.');

async function readNotes(notesPath) {
  const notes = (
    await readFile(notesPath, 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`Crie ${notesPath} com as mudanças desta versão antes de gerar o manifesto.`);
    })
  ).trim();
  if (!notes) throw new Error(`As notas da versão em ${notesPath} estão vazias.`);
  return notes;
}

const localizedNotes = {
  'pt-BR': await readNotes(`docs/release-notes/${version}.txt`),
  'en-US': await readNotes(`docs/release-notes/${version}.en-US.txt`),
};

const manifest = {
  version,
  notes: localizedNotes['en-US'],
  localizedNotes,
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/leandrolsouza/fedexe-api-delivery/releases/download/v${version}/${name}`,
    },
  },
};
await writeFile(join(dirname(installer), 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
