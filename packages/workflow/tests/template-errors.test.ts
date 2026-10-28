import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * What the editor says when a template's kind is wrong — the text, not just that there is an
 * error. The `never` slots of `TemplateTopic` are string literals written to be read, and the
 * third member catches a template that says neither; `tsc` over `fixtures/template-errors` is
 * the only way to see the wording, since TypeScript 7 ships no compiler API.
 */

const fixture = resolve(import.meta.dirname, 'fixtures/template-errors');
const tsc = resolve(import.meta.dirname, '../../../node_modules/.bin/tsc');

function diagnostics(): string {
  try {
    return execFileSync(tsc, ['-p', fixture, '--pretty', 'false'], { encoding: 'utf8' });
  } catch (error) {
    return (error as { stdout: string }).stdout;
  }
}

/** The line each `// mistake: <name>` marker points at (the call on the next line), by name. */
function mistakes(): Map<string, number> {
  const lines = readFileSync(resolve(fixture, 'mistakes.ts'), 'utf8').split('\n');
  const found = new Map<string, number>();
  lines.forEach((line, i) => {
    const name = /^\/\/ mistake: (\w+)/.exec(line)?.[1];
    if (name !== undefined) found.set(name, i + 2);
  });
  return found;
}

describe.skipIf(!existsSync(tsc))('a template that says the wrong thing', () => {
  const output = diagnostics();
  const at = mistakes();
  const errorOf = (name: string) => {
    const line = at.get(name);
    if (line === undefined) throw new Error(`no '// mistake: ${name}' marker in the fixture`);
    return new RegExp(`mistakes\\.ts\\(${line},\\d+\\): [^]*?(?=\\n\\S|$)`).exec(output)?.[0] ?? '';
  };

  test('neither topic nor transactional: the missing property names both options', () => {
    for (const name of ['email_neither', 'push_neither']) {
      expect(errorOf(name)).toContain("Property ''topic | transactional'' is missing");
      expect(errorOf(name)).toContain(
        "every template says what it is: 'topic: <id>' (one the contract declares) or 'transactional: true'"
      );
    }
  });

  test('both, or transactional as a boolean: the error is at the property and says so', () => {
    for (const name of ['email_both', 'push_both', 'email_bool']) {
      expect(errorOf(name)).toMatch(/^mistakes\.ts\(\d+,\d+\): error TS2322/);
      expect(errorOf(name)).toContain("give either 'topic' or 'transactional: true', not both");
    }
  });

  test('a transactional email with an unsubscribe link: the error names unsubscribeUrl', () => {
    expect(errorOf('email_url')).toContain("Types of property 'unsubscribeUrl' are incompatible");
    expect(errorOf('email_url')).toContain(
      "a transactional email has no unsubscribe link, so it takes no 'unsubscribeUrl'"
    );
  });

  test('with templatesFor(contract), an undeclared topic fails at the template, listing the declared ones', () => {
    for (const name of ['email_undeclared', 'push_undeclared']) {
      expect(errorOf(name)).toMatch(/^mistakes\.ts\(\d+,\d+\): error TS2322: Type '"digest"'/);
      expect(errorOf(name)).toContain('"newsletter" | "promotions"');
    }
  });

  test('nothing else in the fixture fails', () => {
    const failing = [...output.matchAll(/mistakes\.ts\((\d+),\d+\): error/g)].map((m) =>
      Number(m[1])
    );
    expect([...new Set(failing)].sort((a, b) => a - b)).toEqual(
      [...at.values()].sort((a, b) => a - b)
    );
  });
});
