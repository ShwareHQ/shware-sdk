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
 *
 * ## What the studio may edit, and why the list is short
 *
 * The model is SwiftUI's, not Interface Builder's: the code is the truth, the
 * canvas is a projection of it, and the projection may write back only through
 * edits that cannot invalidate the code. Structure — what a step is, and where
 * it sits — stays in the editor, where a diff and a review can see it.
 *
 * A value is editable only if all four hold:
 *
 *  1. **Total** — every value in the domain maps to another valid value of the
 *     same shape, so the UI never has to invent one. A duration swaps for a
 *     duration; `delay` has no canonical translation into `waitUntil`.
 *  2. **Literal-backed** — a string / number / boolean literal in source, not
 *     an expression and not an identifier. A text box that can name something
 *     that does not exist is a text box that can stop the project compiling —
 *     and the studio is served by that same project.
 *  3. **Locatable** — the DSL captured a source position for it
 *     (NodeMetaIR.loc), or a name resolves to it.
 *  4. **Id-stable** — ids are structural paths and double as the engine's
 *     durable step names, so `ir.ts` states the rule: editing a node's
 *     parameters keeps its id, inserting one shifts every later sibling's.
 *     An edit that renumbers steps strands in-flight users and orphans every
 *     stats key, which is far more damage than the edit is worth.
 *
 * Deliberately excluded, and not to be added later without revisiting the
 * above:
 *
 *  - **Identifier references** — `e.purchase`, `u.plan`, `t.welcome`, segment
 *    names. Fails (2). Would need a picker constrained to what is in scope
 *    plus import management, never free text.
 *  - **Cohort arm names** — they are interpolated into node ids
 *    (`{cohortId}.{armName}.{j}`), so a rename is an id change. Fails (4), and
 *    it is the edit that looks smallest while doing the most damage.
 *  - **Cohort weights** — must sum to 100, so no single weight is independently
 *    valid. Fails (1); would need an editor that writes every arm at once.
 *  - **Structure** — adding, removing, reordering or retyping nodes. Fails (4).
 *
 * Fields that are absent from source are read-only too: this module replaces
 * existing literals and never inserts, so a patch can never produce a syntax
 * error. Insertion is possible — guarded by re-parsing and rolling back — but
 * that is a separate decision from this one.
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

/**
 * Splice, then check the file still parses; restore it if not.
 *
 * Replacing a literal cannot break syntax, but inserting can — a stray comma, a
 * lost paren — so insertion is only safe with this. It turns "the studio can
 * break the project" into "the save can fail", which is the same failure a
 * non-literal target already produces.
 */
function spliceChecked(filePath: string, start: number, end: number, text: string): PatchResult {
  const before = readFileSync(filePath, 'utf8');
  splice(filePath, start, end, text);
  const diagnostics = (parse(filePath) as { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics;
  if (diagnostics === undefined || diagnostics.length === 0) return { ok: true };
  writeFileSync(filePath, before);
  return fail('that edit would not parse — nothing was written');
}

/** The indentation of the line `position` sits on, so inserted code lines up. */
function indentAt(source: ts.SourceFile, position: number): string {
  const text = source.getFullText();
  const lineStart = text.lastIndexOf('\n', position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, position))?.[0] ?? '';
}

/**
 * Add `key: value` to an object literal, matching how the object is written:
 * appended on its own line when the object is multi-line, inline when it is not.
 */
function insertProperty(
  filePath: string,
  source: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
  key: string,
  value: string
): PatchResult {
  const properties = object.properties;
  const last = properties[properties.length - 1];
  const entry = `${key}: ${quote(value)}`;

  if (last === undefined) {
    return spliceChecked(filePath, object.getStart(source) + 1, object.getEnd() - 1, ` ${entry} `);
  }
  /*
   * Always lead with the comma and insert straight after the last property, so
   * an existing trailing comma ends up terminating the new entry instead of
   * doubling up — which is what the parse check caught the first time round.
   */
  const multiline = source
    .getFullText()
    .slice(object.getStart(source), object.getEnd())
    .includes('\n');
  const insertion = multiline
    ? `,\n${indentAt(source, last.getStart(source))}${entry}`
    : `, ${entry}`;
  return spliceChecked(filePath, last.getEnd(), last.getEnd(), insertion);
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

/**
 * The module-level exports the studio may edit. `name` and `description` are
 * labels — excluded from every hash and read by nothing but the UI — so they
 * are the safest thing here; the rest are envelope values the engine sends.
 */
export type EnvelopeField = 'from' | 'replyTo' | 'subject' | 'name' | 'description';

const ENVELOPE_FIELDS: readonly EnvelopeField[] = [
  'from',
  'replyTo',
  'subject',
  'name',
  'description',
];

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
  return Object.fromEntries(ENVELOPE_FIELDS.map((field) => [field, editable(field)])) as Record<
    EnvelopeField,
    boolean
  >;
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
  if (elements.length === 1) {
    splice(configPath, addressesArray.getStart(source) + 1, addressesArray.getEnd() - 1, '');
  } else if (index === 0) {
    // First of several: remove through to the next element's start (eats the comma)
    splice(configPath, target.getStart(source), elements[1].getStart(source), '');
  } else {
    // Otherwise remove from the previous element's end (eats the preceding comma)
    splice(configPath, elements[index - 1].getEnd(), target.getEnd(), '');
  }
  return { ok: true };
}

/* ------------------------------- Flow nodes -------------------------------- */

/**
 * The DSL captures a source position for every node it builds (see
 * provenance.ts), so a node in the IR already knows the call that made it —
 * no second walker re-deriving structural ids from syntax, and no guessing
 * which of several identical `.delay('7 days')` calls was meant.
 *
 * V8 reports the position of the method name, so `position` lands on the
 * `delay` of `.delay('7 days')`; from there the call expression is the
 * grandparent, and its first string literal is the value to replace.
 */
function callAt(source: ts.SourceFile, offset: number): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (node.getStart(source) > offset || node.getEnd() <= offset) return;
    if (ts.isCallExpression(node) && found === undefined) {
      /*
       * Identity is where the callee's *name* starts, not where the call does:
       * in a chain every enclosing call also spans the offset. Two shapes reach
       * here — `w.delay('7 days')`, whose name is the property, and `eq(u.x,
       * 'y')`, whose name is the callee itself (conditions are free functions).
       */
      const callee = node.expression;
      const nameStart = ts.isPropertyAccessExpression(callee)
        ? callee.name.getStart(source)
        : ts.isIdentifier(callee)
          ? callee.getStart(source)
          : undefined;
      if (nameStart === offset) found = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Byte offset of a 1-based line / 0-based column, or undefined if out of range. */
export function offsetOf(filePath: string, line: number, column: number): number | undefined {
  const source = parse(filePath);
  try {
    return source.getPositionOfLineAndCharacter(line - 1, column);
  } catch {
    return undefined;
  }
}

/**
 * Where a value sits inside the call that produced it. Segments resolve left to
 * right from the argument list: a number indexes arguments or array elements, a
 * string names an object property. `[0]` is `delay('7 days')`; `[1, 'timeout']`
 * is `waitUntil(cond, { timeout: '7 days' })`; `[0, 'between', 1]` is
 * `timeWindow({ between: ['09:00', '17:00'] })`.
 */
export type ValuePath = readonly (string | number)[];

type Literal = ts.StringLiteral | ts.NumericLiteral | ts.BooleanLiteral;

function isLiteral(node: ts.Node): node is Literal {
  return (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  );
}

/** Follow a path from a call's arguments to the expression it addresses. */
function resolvePath(call: ts.CallExpression, path: ValuePath): ts.Expression | undefined {
  let current: ts.Node | undefined = undefined;
  for (const [depth, segment] of path.entries()) {
    const scope: readonly ts.Node[] =
      depth === 0
        ? call.arguments
        : current !== undefined && ts.isObjectLiteralExpression(current)
          ? current.properties
          : current !== undefined && ts.isArrayLiteralExpression(current)
            ? current.elements
            : [];
    if (typeof segment === 'number') {
      current = scope[segment];
    } else {
      const property = scope.find(
        (node): node is ts.PropertyAssignment =>
          ts.isPropertyAssignment(node) &&
          (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
          node.name.text === segment
      );
      current = property?.initializer;
    }
    // A property assignment reached by index still has to be unwrapped to its value
    if (current !== undefined && ts.isPropertyAssignment(current)) current = current.initializer;
    if (current === undefined) return undefined;
  }
  return current !== undefined && ts.isExpression(current) ? current : undefined;
}

function literalAt(filePath: string, offset: number, path: ValuePath): Literal | undefined {
  const source = parse(filePath);
  const call = callAt(source, offset);
  if (call === undefined) return undefined;
  const target = resolvePath(call, path);
  return target !== undefined && isLiteral(target) ? target : undefined;
}

/** The literal's current text, or undefined when the value is not one the studio may edit. */
export function callLiteralAt(
  filePath: string,
  offset: number,
  path: ValuePath
): string | undefined {
  const literal = literalAt(filePath, offset, path);
  return literal === undefined ? undefined : literal.getText();
}

/**
 * Replace the literal the path addresses. Strings keep their quote characters
 * (only the text between them is spliced) so the file's quote style survives;
 * numbers and booleans replace whole.
 */
export function patchCallLiteral(
  filePath: string,
  offset: number,
  path: ValuePath,
  value: string
): PatchResult {
  const source = parse(filePath);
  const call = callAt(source, offset);
  if (call === undefined) return fail('no call expression at the recorded source position');
  const target = resolvePath(call, path);

  if (target === undefined) {
    /*
     * Absent, so insert — but only for the one shape that is unambiguous: a
     * named property whose container is an object literal that either exists or
     * can be appended as a trailing argument. Anything deeper would be guessing
     * at structure, which is where this stops.
     */
    const key = path[path.length - 1];
    if (typeof key !== 'string') return fail('that value is absent from source — add it in code');
    const parentPath = path.slice(0, -1);
    const parent = parentPath.length === 0 ? undefined : resolvePath(call, parentPath);

    if (parent !== undefined && ts.isObjectLiteralExpression(parent)) {
      return insertProperty(filePath, source, parent, key, value);
    }
    // The options object itself is missing: append it as the next argument
    const index = parentPath[parentPath.length - 1];
    if (parentPath.length === 1 && index === call.arguments.length) {
      const last = call.arguments[call.arguments.length - 1];
      const at = last === undefined ? call.getEnd() - 1 : last.getEnd();
      return spliceChecked(filePath, at, at, `, { ${key}: ${quote(value)} }`);
    }
    return fail('that value is absent from source — add it in code');
  }

  if (!isLiteral(target)) return fail('that value is an expression in source — edit it in code');

  if (ts.isStringLiteral(target)) {
    return spliceChecked(
      filePath,
      target.getStart(source) + 1,
      target.getEnd() - 1,
      quote(value).slice(1, -1)
    );
  }
  const trimmed = value.trim();
  const numeric = ts.isNumericLiteral(target);
  if (numeric && !/^-?\d+(\.\d+)?$/.test(trimmed)) return fail('expected a number');
  if (!numeric && trimmed !== 'true' && trimmed !== 'false') return fail('expected true or false');
  return spliceChecked(filePath, target.getStart(source), target.getEnd(), trimmed);
}
