import { VariableFieldOrigins } from './VariableFieldOrigins';
import type { EditableVariable } from './VariableUrlInput';
import { t } from '../lib/i18n';
import { Eye, EyeOff, LockKeyhole, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { pair, type Pair } from '../lib/models';
import { Button } from './ui/button';

export function PairEditor({
  rows,
  onChange,
  kind = t('parâmetro'),
  variables = false,
  maskValue,
  markSecrets = false,
  searchable = false,
  resolveVariable,
  focusVariable,
}: {
  rows: Pair[];
  onChange: (rows: Pair[]) => void;
  kind?: string;
  variables?: boolean;
  maskValue?: (row: Pair) => boolean;
  markSecrets?: boolean;
  searchable?: boolean;
  resolveVariable?: (name: string) => EditableVariable | undefined;
  focusVariable?: { id: string; request: string };
}) {
  const [visible, setVisible] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [focusedRow, setFocusedRow] = useState<string>();
  const newRow = useRef<string>(undefined);
  const keyInputs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    if (!focusVariable) return;
    setSearch('');
    setFocusedRow(focusVariable.id);
    const frame = requestAnimationFrame(() => {
      const input = keyInputs.current.get(focusVariable.id);
      input?.focus();
      input?.select();
      input?.closest('.pair-row')?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusVariable?.id, focusVariable?.request]);
  const query = search.trim().toLowerCase();
  const displayed = query
    ? rows.filter((row) => row.id === focusedRow || row.key.toLowerCase().includes(query))
    : rows;
  const update = (id: string, patch: Partial<Pair>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <div className="pair-editor">
      {searchable && (
        <label className="search-field">
          <Search size={14} />
          <input
            type="search"
            aria-label={t('Buscar variável pelo nome')}
            placeholder={t('Buscar variável pelo nome')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      )}
      <div className="pair-table" role="table" aria-label={t('Editor de {0}s', kind)}>
        <div className="pair-row pair-heading" role="row">
          <span />
          <span role="columnheader">{variables ? t('Variável') : t('Chave')}</span>
          <span role="columnheader">{t('Valor')}</span>
          <span />
        </div>
        {displayed.map((row) => (
          <div
            className={`pair-row ${!row.enabled ? 'row-disabled' : ''} ${focusedRow === row.id && focusVariable?.id === row.id ? 'variable-target' : ''}`}
            data-variable-id={row.id}
            role="row"
            key={row.id}
            onFocus={searchable || variables ? () => setFocusedRow(row.id) : undefined}
            onBlur={
              searchable || variables
                ? (event) => {
                    if (!event.currentTarget.contains(event.relatedTarget))
                      setFocusedRow(undefined);
                  }
                : undefined
            }
          >
            <div role="cell">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(event) => update(row.id, { enabled: event.target.checked })}
                aria-label={t('Ativar {0}', row.key || kind)}
              />
            </div>
            <div role="cell" className="variable-origin-field">
              <input
                ref={(input) => {
                  if (input) keyInputs.current.set(row.id, input);
                  else keyInputs.current.delete(row.id);
                  if (searchable && input && newRow.current === row.id) {
                    newRow.current = undefined;
                    input.focus();
                  }
                }}
                className="table-input mono"
                value={row.key}
                placeholder={variables ? t('nome_da_variavel') : t('Chave')}
                aria-label={t('{0} {1}', variables ? t('Nome da') : t('Nome do'), kind)}
                onChange={(event) => update(row.id, { key: event.target.value })}
                spellCheck={false}
              />
              <VariableFieldOrigins value={row.key} resolveVariable={resolveVariable} />
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
              <VariableFieldOrigins
                value={row.value}
                resolveVariable={resolveVariable}
                masked={!!maskValue?.(row) || (!!row.secret && !visible.includes(row.id))}
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
        {displayed.length === 0 && (
          <div className="empty-table">
            {query ? t('Nenhuma variável encontrada.') : t('Não há linhas configuradas.')}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="add-row"
        onClick={() => {
          const row = pair();
          if (searchable) {
            newRow.current = row.id;
            setSearch('');
          }
          onChange([...rows, row]);
        }}
      >
        <Plus size={14} />
        {' ' + t('Adicionar') + ' '}
        {kind}
      </Button>
    </div>
  );
}
