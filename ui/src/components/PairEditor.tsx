import { t } from '../lib/i18n';
import { Eye, EyeOff, LockKeyhole, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { pair, type Pair } from '../lib/models';
import { Button } from './ui/button';

export function PairEditor({
  rows,
  onChange,
  kind = t('parâmetro'),
  variables = false,
  maskValue,
  markSecrets = false,
}: {
  rows: Pair[];
  onChange: (rows: Pair[]) => void;
  kind?: string;
  variables?: boolean;
  maskValue?: (row: Pair) => boolean;
  markSecrets?: boolean;
}) {
  const [visible, setVisible] = useState<string[]>([]);
  const update = (id: string, patch: Partial<Pair>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <div className="pair-editor">
      <div className="pair-table" role="table" aria-label={t('Editor de {0}s', kind)}>
        <div className="pair-row pair-heading" role="row">
          <span />
          <span role="columnheader">{variables ? t('Variável') : t('Chave')}</span>
          <span role="columnheader">{t('Valor')}</span>
          <span />
        </div>
        {rows.map((row) => (
          <div className={`pair-row ${!row.enabled ? 'row-disabled' : ''}`} role="row" key={row.id}>
            <div role="cell">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(event) => update(row.id, { enabled: event.target.checked })}
                aria-label={t('Ativar {0}', row.key || kind)}
              />
            </div>
            <div role="cell">
              <input
                className="table-input mono"
                value={row.key}
                placeholder={variables ? t('nome_da_variavel') : t('Chave')}
                aria-label={t('{0} {1}', variables ? t('Nome da') : t('Nome do'), kind)}
                onChange={(event) => update(row.id, { key: event.target.value })}
                spellCheck={false}
              />
            </div>
            <div className="pair-value" role="cell">
              <input
                className={`table-input mono ${row.value.includes('{{') ? 'variable-value' : ''}`}
                value={row.value}
                type={
                  maskValue?.(row) || (row.secret && !visible.includes(row.id))
                    ? 'password'
                    : 'text'
                }
                placeholder={row.secret ? t('Segredo') : t('Valor')}
                aria-label={t('Valor de {0}', row.key || kind)}
                onChange={(event) => update(row.id, { value: event.target.value })}
                spellCheck={false}
                autoComplete="off"
              />
              {row.secret && !maskValue && (
                <button
                  className="inline-icon"
                  aria-label={visible.includes(row.id) ? t('Ocultar valor') : t('Mostrar valor')}
                  title={visible.includes(row.id) ? t('Ocultar valor') : t('Mostrar valor')}
                  onClick={() =>
                    setVisible((current) =>
                      current.includes(row.id)
                        ? current.filter((id) => id !== row.id)
                        : [...current, row.id],
                    )
                  }
                >
                  {visible.includes(row.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
            <div className="pair-actions" role="cell">
              {(variables || markSecrets) && (
                <button
                  className={`inline-icon ${row.secret ? 'secret-active' : ''}`}
                  aria-label={t(
                    '{0} {1} como segredo',
                    row.secret ? t('Desmarcar') : t('Marcar'),
                    row.key || t('variável'),
                  )}
                  title={
                    row.secret && variables
                      ? t('Desmarcar segredo e limpar valor')
                      : row.secret
                        ? t('Desmarcar como segredo')
                        : t('Marcar como segredo')
                  }
                  onClick={() =>
                    update(
                      row.id,
                      row.secret && variables
                        ? { secret: false, value: '' }
                        : { secret: !row.secret },
                    )
                  }
                >
                  <LockKeyhole size={13} />
                </button>
              )}
              <button
                className="inline-icon delete-row"
                aria-label={t('Remover {0}', row.key || kind)}
                onClick={() => onChange(rows.filter((p) => p.id !== row.id))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="empty-table">{t('Não há linhas configuradas.')}</div>}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="add-row"
        onClick={() => onChange([...rows, pair()])}
      >
        <Plus size={14} />
        {' ' + t('Adicionar') + ' '}
        {kind}
      </Button>
    </div>
  );
}
