import { semanticHash } from '../hash';
import { type BundleIR, BundleIR as BundleIRSchema, IR_VERSION, type SegmentIR } from '../ir';
import type { SegmentInternal, SegmentRef } from './condition';
import type { TemplateRef } from './template';
import type { WorkflowBuilder } from './workflow';

/**
 * The deployment unit — compileBundle gathers workflows, segments and the
 * template manifest into one BundleIR snapshot (terraform-apply mental model);
 * the server diffs each definition by contentHash (see plan.ts).
 */
export function compileBundle(input: {
  workflows: readonly WorkflowBuilder[];
  segments?: readonly SegmentRef[];
  templates?: readonly TemplateRef[];
}): BundleIR {
  const segments = (input.segments ?? []).map((segment) => {
    const { name, definition, loc } = segment as SegmentInternal;
    const compiled: SegmentIR = {
      irVersion: IR_VERSION,
      name,
      contentHash: semanticHash(definition),
      condition: definition,
    };
    if (loc !== undefined) compiled.meta = { loc };
    return compiled;
  });

  const templates = (input.templates ?? []).map((template) => ({
    irVersion: IR_VERSION,
    key: template.key,
    channel: template.channel,
  }));

  const workflows = input.workflows.map((builder) => builder.toIR());

  // Names are wire identity (routing tables, entry ledger, by-name refs):
  // duplicates would silently last-write-win on deploy, so fail the compile.
  assertUniqueNames(
    workflows.map((w) => w.name),
    'workflow'
  );
  assertUniqueNames(
    segments.map((s) => s.name),
    'segment'
  );

  return BundleIRSchema.parse({ irVersion: IR_VERSION, workflows, segments, templates });
}

function assertUniqueNames(names: readonly string[], kind: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`compileBundle: duplicate ${kind} name '${name}'`);
    seen.add(name);
  }
}
