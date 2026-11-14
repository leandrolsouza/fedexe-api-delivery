import { Eye, EyeOff, LockKeyhole, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { pair, type Pair } from '../lib/models';
import { Button } from './ui/button';

export function PairEditor({
  rows,
  onChange,
  kind = 'parâmetro',
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
      <div className="pair-table" role="table" aria-label={`Editor de ${kind}s`}>
        <div className="pair-row pair-heading" role="row">
          <span />
          <span role="columnheader">{variables ? 'Variável' : 'Chave'}</span>
          <span role="columnheader">Valor</span>
          <span />
        </div>
        {rows.map((row) => (
          <div className={`pair-row ${!row.enabled ? 'row-disabled' : ''}`} role="row" key={row.id}>
            <div role="cell">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(event) => update(row.id, { enabled: event.target.checked })}
                aria-label={`Ativar ${row.key || kind}`}
              />
            </div>
            <div role="cell">
              <input
                className="table-input mono"
                value={row.key}
                placeholder={variables ? 'nome_da_variavel' : 'Chave'}
                aria-label={`${variables ? 'Nome da' : 'Nome do'} ${kind}`}
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
                placeholder={row.secret ? 'Segredo' : 'Valor'}
                aria-label={`Valor de ${row.key || kind}`}
                onChange={(event) => update(row.id, { value: event.target.value })}
                spellCheck={false}
                autoComplete="off"
              />
              {row.secret && !maskValue && (
                <button
                  className="inline-icon"
                  aria-label={visible.includes(row.id) ? 'Ocultar valor' : 'Mostrar valor'}
                  title={visible.includes(row.id) ? 'Ocultar valor' : 'Mostrar valor'}
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
                  aria-label={`${row.secret ? 'Desmarcar' : 'Marcar'} ${row.key || 'variável'} como segredo`}
                  title={
                    row.secret && variables
                      ? 'Desmarcar segredo e limpar valor'
                      : row.secret
                        ? 'Desmarcar como segredo'
                        : 'Marcar como segredo'
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
                aria-label={`Remover ${row.key || kind}`}
                onClick={() => onChange(rows.filter((p) => p.id !== row.id))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="empty-table">Nenhum {kind} configurado. Adicione o primeiro abaixo.</div>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="add-row"
        onClick={() => onChange([...rows, pair()])}
      >
        <Plus size={14} /> Adicionar {kind}
      </Button>
    </div>
  );
}
