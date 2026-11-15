import { t } from '../lib/i18n';
import { File, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { pair, type MultipartRow, type RequestItem } from '../lib/models';
import { native, normalizeError, pickBodyFile } from '../lib/transport';
import { Button } from './ui/button';

function FilePicker({ path, onChange }: { path: string; onChange: (path: string) => void }) {
  async function choose() {
    try {
      const selected = await pickBodyFile();
      if (selected) onChange(selected);
    } catch (error) {
      toast.error(normalizeError(error).message);
    }
  }
  return (
    <div className="body-file-picker">
      <Button variant="outline" size="sm" onClick={choose}>
        <File size={14} />
        {' ' + t('Selecionar arquivo')}
      </Button>
      <span title={path}>{path.split(/[/\\]/).at(-1) || t('Nenhum arquivo selecionado')}</span>
      {path && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('Remover arquivo')}
          onClick={() => onChange('')}
        >
          <Trash2 size={14} />
        </Button>
      )}
    </div>
  );
}

export function FileBodyEditor({
  request,
  onChange,
}: {
  request: RequestItem;
  onChange: (value: Partial<RequestItem>) => void;
}) {
  if (!native)
    return (
      <p className="field-hint">
        {t('Multipart e arquivos binários estão disponíveis no app desktop.')}
      </p>
    );
  if (request.bodyType === 'binary')
    return (
      <FilePicker
        path={request.binaryFile ?? ''}
        onChange={(binaryFile) => onChange({ binaryFile })}
      />
    );

  const rows = request.multipart ?? [];
  const update = (id: string, patch: Partial<MultipartRow>) =>
    onChange({ multipart: rows.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
  return (
    <div className="multipart-editor">
      {rows.map((row) => (
        <div className="multipart-row" key={row.id}>
          <input
            type="checkbox"
            aria-label={t('Ativar {0}', row.key || 'parte')}
            checked={row.enabled}
            onChange={(event) => update(row.id, { enabled: event.target.checked })}
          />
          <input
            className="input mono"
            aria-label={t('Nome da parte')}
            placeholder={t('Nome')}
            value={row.key}
            onChange={(event) => update(row.id, { key: event.target.value })}
          />
          <select
            className="input"
            aria-label={t('Tipo da parte')}
            value={row.kind}
            onChange={(event) =>
              update(row.id, { kind: event.target.value as MultipartRow['kind'], value: '' })
            }
          >
            <option value="field">{t('Campo')}</option>
            <option value="file">{t('Arquivo')}</option>
          </select>
          {row.kind === 'file' ? (
            <FilePicker path={row.value} onChange={(value) => update(row.id, { value })} />
          ) : (
            <input
              className="input mono"
              aria-label={t('Valor do campo')}
              placeholder={t('Valor')}
              value={row.value}
              onChange={(event) => update(row.id, { value: event.target.value })}
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('Remover {0}', row.key || 'parte')}
            onClick={() => onChange({ multipart: rows.filter(({ id }) => id !== row.id) })}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange({ multipart: [...rows, { ...pair(), kind: 'field' }] })}
      >
        <Plus size={14} />
        {' ' + t('Adicionar parte')}
      </Button>
    </div>
  );
}
