import { describe, it, expect } from "vitest";
import { toCsv, parseCsv } from "../src/csv";

describe("CSV", () => {
  it("gera cabeçalho e linhas com quoting de vírgula, aspas e quebra de linha", () => {
    const out = toCsv([{ a: "x,y", b: 'diz "oi"', c: "l1\nl2" }], ["a", "b", "c"]);
    expect(out).toBe('a,b,c\r\n"x,y","diz ""oi""","l1\nl2"\r\n');
  });
  it("neutraliza fórmulas (CSV injection) prefixando apóstrofo", () => {
    const out = toCsv([{ a: "=1+1", b: "+cmd", c: "-2", d: "@x", e: "ok" }], ["a", "b", "c", "d", "e"]);
    expect(out).toContain("'=1+1,'+cmd,'-2,'@x,ok");
  });
  it("números ficam como estão (inclusive negativos) e nulos viram vazio", () => {
    expect(toCsv([{ a: -5, b: null, c: 0 }], ["a", "b", "c"])).toBe("a,b,c\r\n-5,,0\r\n");
  });
  it("ida e volta preserva o conteúdo", () => {
    const rows = [{ n: "Maria, a Grande", v: 'ela disse "sim"', m: "a\nb" }];
    expect(parseCsv(toCsv(rows, ["n", "v", "m"]))).toEqual(rows);
  });
  it("lê ponto e vírgula (Excel pt-BR), BOM e CRLF", () => {
    expect(parseCsv("﻿nome;valor\r\nAna;10,50\r\nBia;3\r\n")).toEqual([{ nome: "Ana", valor: "10,50" }, { nome: "Bia", valor: "3" }]);
  });
  it("ignora linhas em branco e recusa aspas não fechadas", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4\n")).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
    expect(() => parseCsv('a\n"aberta')).toThrow(/aspas/);
  });
  it("limita linhas para não estourar memória", () => {
    expect(() => parseCsv("a\n1\n2\n3\n", { maxRows: 2 })).toThrow(/linhas/);
  });
});
