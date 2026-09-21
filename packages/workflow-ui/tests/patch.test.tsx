import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript-5';
import { describe, expect, test } from 'vitest';
import {
  addAddress,
  patchCallLiteral,
  patchEnvelopeField,
  updateAddress,
} from '../src/server/patch';

/**
 * Values a studio text field accepts without complaint and a naive splice cannot
 * survive: a pasted newline ends the literal at the end of the line, a double
 * quote closes a double-quoted literal early, and a lone backslash escapes
 * whatever follows it.
 */
const HOSTILE = {
  newline: 'Line one\nLine two',
  doubleQuote: 'She said "hello" once',
  backslashAndQuote: "C:\\temp and it's fine",
  lineSeparator: 'before\u2028after\u2029end',
};

/** A throwaway file on disk — every patch entry point takes a path, not a string. */
function fixture(name: string, contents: string): string {
  const filePath = join(mkdtempSync(join(tmpdir(), 'patch-')), name);
  writeFileSync(filePath, contents);
  return filePath;
}

/**
 * Re-parse the patched file the way the project's own build would. A splice that
 * breaks the file usually still reads back as plausible text, so the parse is
 * what actually distinguishes a good write from a corrupt one.
 */
function parsedFile(filePath: string): ts.SourceFile {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const diagnostics =
    (source as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  expect(diagnostics.map((d) => d.messageText)).toEqual([]);
  return source;
}

/** The cooked value of `export const <name> = '...'`, i.e. what the engine would send. */
function exportedString(filePath: string, name: string): string | undefined {
  for (const statement of parsedFile(filePath).statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const initializer = declaration.initializer;
      return initializer !== undefined && ts.isStringLiteral(initializer)
        ? initializer.text
        : undefined;
    }
  }
  return undefined;
}

/** Cooked values of every string literal in the file, in source order. */
function stringValues(filePath: string): string[] {
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)) values.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(parsedFile(filePath));
  return values;
}

describe('patchEnvelopeField', () => {
  /* The source is deliberately double-quoted: splicing between the existing
   * quotes used to preserve them, and `quote` escapes only single quotes. */
  const source = 'export const subject = "Welcome, friend";\n';

  test.each(Object.entries(HOSTILE))(
    'a value containing %s survives the round trip and leaves the file parsing',
    (label, value) => {
      const filePath = fixture(`${label}.ts`, source);

      expect(patchEnvelopeField(filePath, 'subject', value)).toEqual({ ok: true });
      expect(exportedString(filePath, 'subject')).toBe(value);
    }
  );

  test('a call-wrapped subject is patched at its argument, not at the call', () => {
    const filePath = fixture('wrapped.ts', 'export const subject = emailSubject(u, "Hi there");\n');

    expect(patchEnvelopeField(filePath, 'subject', HOSTILE.doubleQuote)).toEqual({ ok: true });
    expect(stringValues(filePath)).toEqual([HOSTILE.doubleQuote]);
    expect(readFileSync(filePath, 'utf8')).toContain('emailSubject(u, ');
  });

  test('an absent field is inserted after the imports as a parsable export', () => {
    const filePath = fixture(
      'absent.ts',
      "import { x } from './x';\n\nexport const from = 'a@acme.io';\n"
    );

    expect(patchEnvelopeField(filePath, 'subject', HOSTILE.newline)).toEqual({ ok: true });
    expect(exportedString(filePath, 'subject')).toBe(HOSTILE.newline);
    expect(exportedString(filePath, 'from')).toBe('a@acme.io');
  });

  test('a subject that is an expression is refused rather than rewritten', () => {
    const before = 'export const subject = (u) => `Hi ${u.name}`;\n';
    const filePath = fixture('expression.ts', before);

    expect(patchEnvelopeField(filePath, 'subject', 'anything')).toEqual({
      ok: false,
      error: "'subject' is not backed by a string literal — edit it in code",
    });
    expect(readFileSync(filePath, 'utf8')).toBe(before);
  });
});

describe('patchCallLiteral', () => {
  const source = 'export const flow = w.push({ title: "Old title" });\n';

  test.each(Object.entries(HOSTILE))(
    'a message prop containing %s survives the round trip and leaves the file parsing',
    (label, value) => {
      const filePath = fixture(`${label}.ts`, source);
      const offset = readFileSync(filePath, 'utf8').indexOf('push');

      expect(patchCallLiteral(filePath, offset, [0, 'title'], value)).toEqual({ ok: true });
      expect(stringValues(filePath)).toEqual([value]);
    }
  );

  test('an inserted prop carries the same escaping as a replaced one', () => {
    const filePath = fixture('insert.ts', 'export const flow = w.push({ title: "Old" });\n');
    const offset = readFileSync(filePath, 'utf8').indexOf('push');

    expect(patchCallLiteral(filePath, offset, [0, 'body'], HOSTILE.newline)).toEqual({ ok: true });
    expect(stringValues(filePath)).toEqual(['Old', HOSTILE.newline]);
  });
});

describe('the address book', () => {
  const config = "export default { emails: { addresses: ['Acme <hello@acme.io>'] } };\n";

  test('an added display name containing a quote does not end the literal early', () => {
    const filePath = fixture('workflow.config.ts', config);

    expect(addAddress(filePath, HOSTILE.backslashAndQuote)).toEqual({ ok: true });
    expect(stringValues(filePath)).toEqual(['Acme <hello@acme.io>', HOSTILE.backslashAndQuote]);
  });

  test('an updated address round-trips a pasted newline', () => {
    const filePath = fixture('workflow.config.ts', config);

    expect(updateAddress(filePath, 'Acme <hello@acme.io>', HOSTILE.newline)).toEqual({ ok: true });
    expect(stringValues(filePath)).toEqual([HOSTILE.newline]);
  });
});
