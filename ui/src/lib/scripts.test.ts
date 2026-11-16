import { describe, expect, it } from 'vitest';
import { newRequest } from './models';
import { executeScript } from './scripts';

describe('JavaScript de requisição', () => {
  it('substitui variáveis atuais e permite ignorar a etapa dentro de um callback HTTP', async () => {
    const output = await executeScript(
      `
      pm.variables.set("path", "cidades");
      pm.sendRequest(pm.variables.replaceIn("{{ base }}/{{path}}"), (error, response) => {
        if (error) throw error;
        pm.collectionVariables.set("status", response.code);
        pm.execution.skipRequest();
        throw new Error("must not run");
      });
      `,
      newRequest(),
      { base: 'https://example.test' },
      undefined,
      {
        send: async (request) => {
          return {
            status: request.url === 'https://example.test/cidades' ? 200 : 404,
            duration_ms: 1,
            headers: [],
            preview: '{}',
            truncated: false,
          };
        },
      },
    );
    expect(output.error).toBeUndefined();
    expect(output.skipped).toBe(true);
    expect(output.writes).toEqual([
      ['path', 'cidades'],
      ['status', '200'],
    ]);
  });

  it('avalia asserções importadas de pós-resposta e distingue falhas reais', async () => {
    const output = await executeScript(
      `
      const json = pm.response.json();
      pm.test("pessoa criada", () => {
        pm.response.to.have.status(201);
        pm.expect(json).to.have.property("id");
        pm.expect(json.nuVersao).to.eql(1);
        pm.expect(json.tipoPessoa).to.eql("PF");
        pm.expect(json.flCliente).to.eql(false);
      });
      pm.test("cadeias", () => {
        pm.expect(json).to.have.property("id").that.eql("fixture");
        pm.expect(json.id).to.be.a("string").and.not.empty;
        pm.expect(["a", "b"]).to.be.an("array").and.include("a");
        pm.expect(["a"]).to.have.lengthOf.above(0);
        pm.expect(2).to.be.above(1);
        pm.expect(null).to.be.null;
        pm.expect(json.id).to.not.be.undefined;
        pm.expect({ a: [1, 2] }).to.eql({ a: [1, 2] });
      });
      pm.test("ausente", () => pm.expect(json).to.have.property("inexistente"));
      pm.test("diferente", () => pm.expect(json.nuVersao).to.eql(2));
      pm.test("negação", () => pm.expect([]).to.not.be.empty);
      `,
      newRequest(),
      {},
      {
        status: 201,
        duration_ms: 1,
        headers: [],
        preview: '{"id":"fixture","nuVersao":1,"tipoPessoa":"PF","flCliente":false}',
        truncated: false,
      },
    );
    expect(output.error).toBeUndefined();
    expect(output.tests.map(({ passed }) => passed)).toEqual([true, true, false, false, false]);
  });

  it('executa testes e acessa a resposta sem globais da aplicação', async () => {
    const output = await executeScript(
      `
      pm.test("isolado", () => {
        for (const name of ["fetch", "window", "process", "__TAURI_INTERNALS__"]) {
          pm.expect(typeof globalThis[name]).to.equal("undefined");
        }
      });
      pm.test("status incorreto", () => pm.response.to.have.status(201));
      pm.environment.set("token", pm.response.json().token);
      `,
      newRequest(),
      {},
      { status: 200, duration_ms: 12, headers: [], preview: '{"token":"abc"}', truncated: false },
    );
    expect(output.error).toBeUndefined();
    expect(output.tests).toMatchObject([
      { label: 'isolado', passed: true },
      { label: 'status incorreto', passed: false },
    ]);
    expect(output.writes).toEqual([['token', 'abc']]);
  });

  it('interrompe laços, reporta erros de sintaxe e continua aceitando scripts', async () => {
    const request = newRequest();
    expect((await executeScript('while (true) {}', request, {})).error).toMatch(
      /time limit|limite de tempo/,
    );
    expect((await executeScript('const =', request, {})).error).toBeTruthy();
    expect((await executeScript('pm.test("ok", () => {})', request, {})).tests).toEqual([
      { label: 'ok', passed: true },
    ]);
  });
});
