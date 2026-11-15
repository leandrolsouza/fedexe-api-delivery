import { formatNumber, t } from '../lib/i18n';
import { useState } from 'react';
import { Button } from './ui/button';

function tokens(line: string) {
  return line
    .split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b)/g)
    .map((token, i) => {
      const type = token.startsWith('"')
        ? token.trimEnd().endsWith(':')
          ? 'key'
          : 'string'
        : /^(true|false|null)$/.test(token)
          ? 'boolean'
          : /^-?\d/.test(token)
            ? 'number'
            : '';
      return (
        <span className={type ? `syntax-${type}` : undefined} key={i}>
          {token}
        </span>
      );
    });
}

export function CodeViewer({
  value,
  json = true,
  wrap = true,
}: {
  value: string;
  json?: boolean;
  wrap?: boolean;
}) {
  const [limit, setLimit] = useState(500);
  const lines = value.split('\n');
  return (
    <div
      className={`code-viewer ${wrap ? 'code-wrap' : ''}`}
      tabIndex={0}
      aria-label={t('Corpo da resposta')}
    >
      <pre>
        {lines.slice(0, limit).map((line, index) => (
          <div className="code-line" key={index}>
            <span className="line-number" aria-hidden="true">
              {index + 1}
            </span>
            <code>{json ? tokens(line) : line || ' '}</code>
          </div>
        ))}
      </pre>
      {lines.length > limit && (
        <Button size="sm" variant="secondary" onClick={() => setLimit((v) => v + 500)}>
          {t('Exibir mais linhas (')}
          {formatNumber(lines.length - limit)}
          {' ' + t('restantes)')}
        </Button>
      )}
    </div>
  );
}
