import { describe, expect, it } from 'vitest';
import { importCurl } from './curl';

describe('importação cURL', () => {
  it('preserva query, headers repetidos, Basic e corpo JSON', () => {
    const input = [
      "curl -XPOST 'https://example.test/a?key=x&key=y'",
      "-H 'X-Test: primeiro' -H 'X-Test: segundo' -u 'user:pass:rest'",
      '--json \'{"message":"olá"}\' --max-time=0.5',
    ].join(' \\\n');
    const { request, issues } = importCurl(input);
    expect(request).toMatchObject({
      method: 'POST',
      url: 'https://example.test/a',
      bodyType: 'json',
      body: '{"message":"olá"}',
      timeoutMs: 500,
      auth: { type: 'basic', username: 'user', password: 'pass:rest' },
    });
    expect(request.params.map(({ value }) => value)).toEqual(['x', 'y']);
    expect(request.headers.filter(({ key }) => key === 'X-Test').map(({ value }) => value)).toEqual(
      ['primeiro', 'segundo'],
    );
    expect(issues).toEqual([]);
  });

  it('prepara multipart e pede a seleção de arquivo local', () => {
    const { request, issues } = importCurl(
      "curl -F 'name=Fedexe' -F 'upload=@./file.txt' https://example.test",
    );
    expect(request.bodyType).toBe('multipart');
    expect(request.multipart).toMatchObject([
      { key: 'name', value: 'Fedexe', kind: 'field' },
      { key: 'upload', value: '', kind: 'file' },
    ]);
    expect(issues).toEqual(['Select the file for part upload.']);
  });

  it('recusa opções desconhecidas e comandos com mais de one URL', () => {
    expect(() => importCurl('curl --unknown https://example.test')).toThrow('unsupported');
    expect(() => importCurl('curl https://example.test https://other.test')).toThrow('one URL');
  });
});
