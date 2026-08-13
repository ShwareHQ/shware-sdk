import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
// The project toolchain is typescript@7 (tsgo), which ships no compiler API —
// the classic 5.x package is aliased in as `typescript-5` just for parsing.
import ts from 'typescript-5';

/**
 * Source patching — the write-back half of the studio.
 *
 * Every operation follows one rule: an edit is possible only where the value
 * is backed by a source literal. We locate the exact literal with the
 * TypeScript AST, then splice the raw text at its span — never re-print the
 * file — so formatting, comments and everything around the edit survive
 * byte-for-byte. Vite's watcher picks the change up and HMR closes the loop.
 */

export type PatchResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): PatchResult => ({ ok: false, error });

function parse(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
}

/** Single-quoted string literal in the project's style. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Replace the [start, end) span of the file with `text`, in place on disk. */
function splice(filePath: string, start: number, end: number, text: string): void {
  const source = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, source.slice(0, start) + text + source.slice(end));
}

/** The initializer of `export const <name> = ...`, if the file has one. */
function exportedInitializer(source: ts.SourceFile, name: string): ts.Expression | undefined {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported !== true) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

/**
 * The string literal that backs an envelope field:
 * - `export const from = 'literal'` — the literal itself;
 * - `export const subject = emailSubject(u, 'literal')` — the template argument.
 */
function envelopeLiteral(source: ts.SourceFile, field: string): ts.StringLiteral | undefined {
  const initializer = exportedInitializer(source, field);
  if (initializer === undefined) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer;
  if (ts.isCallExpression(initializer)) {
    const literal = initializer.arguments.find(ts.isStringLiteral);
    if (literal !== undefined) return literal;
  }
  return undefined;
}

export type EnvelopeField = 'from' | 'replyTo' | 'subject';

/**
 * Read-side metadata: which envelope fields the UI may edit. A field is
 * editable when it is absent (we can insert it) or literal-backed; a subject
 * defined as a function of props is code, and code is read-only here.
 */
export function envelopeEditability(modulePath: string): Record<EnvelopeField, boolean> {
  const source = parse(modulePath);
  const editable = (field: EnvelopeField): boolean =>
    exportedInitializer(source, field) === undefined ||
    envelopeLiteral(source, field) !== undefined;
  return { from: editable('from'), replyTo: editable('replyTo'), subject: editable('subject') };
}

/** Set an envelope field to a new string: replace its literal, or insert the export after the imports. */
export function patchEnvelopeField(
  modulePath: string,
  field: EnvelopeField,
  value: string
): PatchResult {
  const source = parse(modulePath);
  const literal = envelopeLiteral(source, field);
  if (literal !== undefined) {
    // +1 / -1: keep the existing quote characters out of the replaced span
    splice(
      modulePath,
      literal.getStart(source) + 1,
      literal.getEnd() - 1,
      quote(value).slice(1, -1)
    );
    return { ok: true };
  }
  if (exportedInitializer(source, field) !== undefined) {
    return fail(`'${field}' is not backed by a string literal — edit it in code`);
  }
  // Insert a fresh export after the last import (or at the top of the file)
  let lastImport: ts.ImportDeclaration | undefined;
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) lastImport = statement;
  }
  const insertAt = lastImport === undefined ? 0 : lastImport.getEnd();
  const lead = lastImport === undefined ? '' : '\n\n';
  const statement = `${lead}export const ${field} = ${quote(value)};`;
  splice(modulePath, insertAt, insertAt, statement);
  return { ok: true };
}

/**
 * Resolve a registry key to the module file that defines it, by reading the
 * conventional emails index: `emails = { key: importedNamespace, ... }` and the
 * import declarations above it.
 */
export function resolveEmailModule(emailsIndexPath: string, key: string): string | undefined {
  const source = parse(emailsIndexPath);
  let registry = exportedInitializer(source, 'emails');
  // The registry is conventionally `{...} as const` — unwrap assertions and parens
  while (
    registry !== undefined &&
    (ts.isAsExpression(registry) ||
      ts.isSatisfiesExpression(registry) ||
      ts.isParenthesizedExpression(registry))
  ) {
    registry = registry.expression;
  }
  if (registry === undefined || !ts.isObjectLiteralExpression(registry)) return undefined;

  // A shorthand `{ key }` cannot say which module the value came from, so only assignments count
  let binding: string | undefined;
  for (const property of registry.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name;
    const matches =
      (ts.isIdentifier(name) && name.text === key) ||
      (ts.isStringLiteral(name) && name.text === key);
    if (matches && ts.isIdentifier(property.initializer)) {
      binding = property.initializer.text;
      break;
    }
  }
  if (binding === undefined) return undefined;

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    const namespace =
      clause?.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)
        ? clause.namedBindings.name.text
        : undefined;
    if (namespace !== binding) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const base = resolve(dirname(emailsIndexPath), statement.moduleSpecifier.text);
    for (const candidate of [base, `${base}.tsx`, `${base}.ts`]) {
      if (candidate.endsWith('.ts') || candidate.endsWith('.tsx')) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

/* ------------------------------- Address book -------------------------------- */

/** The literal `addresses: [...]` array in workflow.config.ts, if there is one. */
function addressesLiteral(source: ts.SourceFile): ts.ArrayLiteralExpression | undefined {
  let found: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'addresses' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const NO_ADDRESS_BOOK =
  'no literal `emails.addresses` array in workflow.config.ts — add one to enable the address book';

/**
 * Append a sender address to `emails.addresses` in workflow.config.ts. Only a
 * literal array can be edited — if the user computes the list, the studio has
 * no business rewriting their code. The same rule carries update and remove.
 */
export function addAddress(configPath: string, address: string): PatchResult {
  const source = parse(configPath);
  const addressesArray = addressesLiteral(source);
  if (addressesArray === undefined) return fail(NO_ADDRESS_BOOK);

  const elements = addressesArray.elements;
  if (elements.some((e) => ts.isStringLiteral(e) && e.text === address)) {
    return fail(`address already in the list: ${address}`);
  }
  if (elements.length === 0) {
    const start = addressesArray.getStart(source);
    splice(configPath, start + 1, start + 1, quote(address));
    return { ok: true };
  }
  const last = elements[elements.length - 1];
  splice(configPath, last.getEnd(), last.getEnd(), `, ${quote(address)}`);
  return { ok: true };
}

/** Replace one address in the literal list with a new value. */
export function updateAddress(
  configPath: string,
  address: string,
  newAddress: string
): PatchResult {
  const source = parse(configPath);
  const addressesArray = addressesLiteral(source);
  if (addressesArray === undefined) return fail(NO_ADDRESS_BOOK);

  const elements = addressesArray.elements;
  const target = elements.find((e) => ts.isStringLiteral(e) && e.text === address);
  if (target === undefined) return fail(`address not in the list: ${address}`);
  if (
    newAddress !== address &&
    elements.some((e) => ts.isStringLiteral(e) && e.text === newAddress)
  ) {
    return fail(`address already in the list: ${newAddress}`);
  }
  splice(configPath, target.getStart(source), target.getEnd(), quote(newAddress));
  return { ok: true };
}

/** Remove one address from the literal list, taking its separating comma along. */
export function removeAddress(configPath: string, address: string): PatchResult {
  const source = parse(configPath);
  const addressesArray = addressesLiteral(source);
  if (addressesArray === undefined) return fail(NO_ADDRESS_BOOK);

  const elements = addressesArray.elements;
  const index = elements.findIndex((e) => ts.isStringLiteral(e) && e.text === address);
  if (index === -1) return fail(`address not in the list: ${address}`);

  const target = elements[index];
  if (target === undefined) return fail(`address not in the list: ${address}`);
  const next = elements[index + 1];
  const previous = elements[index - 1];
  if (elements.length === 1) {
    splice(configPath, addressesArray.getStart(source) + 1, addressesArray.getEnd() - 1, '');
  } else if (index === 0 && next !== undefined) {
    // First of several: remove through to the next element's start (eats the comma)
    splice(configPath, target.getStart(source), next.getStart(source), '');
  } else if (previous !== undefined) {
    // Otherwise remove from the previous element's end (eats the preceding comma)
    splice(configPath, previous.getEnd(), target.getEnd(), '');
  }
  return { ok: true };
}
