import { describe, expect, test } from 'vitest';
import { WorkflowIR, compileBundle, performed, segment, trigger, workflow } from '../src/index';
import type { SourceLocIR } from '../src/ir';
import { normalizeFile } from '../src/provenance';
import { e, gettingStarted, proTips, purchaser, u } from './fixtures';

/**
 * Provenance (slice 1): every builder call records its callsite into meta.loc.
 * Line numbers shift whenever this file is edited, so assertions are
 * relative — same file, increasing lines down a chain — never absolute.
 */

function expectLocInThisFile(loc: SourceLocIR | undefined): SourceLocIR {
  expect(loc).toBeDefined();
  if (!loc) throw new Error('unreachable');
  expect(loc.file.endsWith('tests/provenance.test.ts')).toBe(true);
  expect(loc.line).toBeGreaterThan(0);
  expect(loc.column).toBeGreaterThan(0);
  return loc;
}

describe('callsite recording', () => {
  test('workflow and each chained step record their own callsites in order', () => {
    const ir = workflow('probe', { trigger: trigger.event(e.login) })
      .delay('1 hour')
      .email(gettingStarted)
      .exit('done')
      .toIR();

    const wfLoc = expectLocInThisFile(ir.meta?.loc);
    const nodeLocs = ir.flow.map((node) => expectLocInThisFile(node.meta?.loc));

    // one chain, one call per line: the workflow header comes first, then each step
    expect(nodeLocs[0].line).toBeGreaterThan(wfLoc.line);
    expect(nodeLocs[1].line).toBeGreaterThan(nodeLocs[0].line);
    expect(nodeLocs[2].line).toBeGreaterThan(nodeLocs[1].line);
  });

  test('nodes inside branch arms point at the callback body, not the branch call', () => {
    const ir = workflow('nested', { trigger: trigger.event(e.login) })
      .branch([purchaser, (w) => w.email(proTips)])
      .toIR();

    const branch = ir.flow[0];
    if (branch.type !== 'branch') throw new Error('expected branch');
    const branchLoc = expectLocInThisFile(branch.meta?.loc);
    const armLoc = expectLocInThisFile(branch.cases[0].flow[0].meta?.loc);
    // the arm's .email() sits on the line below the .branch( opener
    expect(armLoc.line).toBeGreaterThan(branchLoc.line - 1);
  });

  test('segments record the segment() callsite into SegmentIR.meta.loc', () => {
    const local = segment('provenance_probe', performed(e.login));
    const bundle = compileBundle({ workflows: [], segments: [local] });
    const loc = expectLocInThisFile(bundle.segments[0].meta?.loc);
    expect(loc.line).toBeGreaterThan(0);
  });

  test('fixture-defined assets point at the fixtures module', () => {
    const bundle = compileBundle({ workflows: [], segments: [purchaser] });
    expect(bundle.segments[0].meta?.loc?.file.endsWith('tests/fixtures.ts')).toBe(true);
  });
});

describe('provenance stays out of execution identity', () => {
  const build = () =>
    workflow('twin', { trigger: trigger.event(e.login) })
      .delay('1 hour')
      .exit();
  const buildElsewhere = () =>
    workflow('twin', { trigger: trigger.event(e.login) })
      .delay('1 hour')
      .exit();

  test('identical semantics at different source locations share a contentHash', () => {
    const a = build().toIR();
    const b = buildElsewhere().toIR();

    expect(a.meta?.loc?.line).not.toBe(b.meta?.loc?.line);
    expect(a.contentHash).toBe(b.contentHash);
  });

  test('IR with locs still passes the authoritative schema and survives JSON', () => {
    const ir = build().toIR();
    const revived = WorkflowIR.parse(JSON.parse(JSON.stringify(ir)));
    expect(revived.flow[0].meta?.loc).toEqual(ir.flow[0].meta?.loc);
  });

  test('loc files never leak an absolute home directory when compiled under Node', () => {
    const loc = expectLocInThisFile(build().toIR().meta?.loc);
    expect(loc.file.startsWith('/')).toBe(false);
  });
});

describe('recorded paths are portable', () => {
  /*
   * normalizeFile is the only platform-aware line in the compiler, and what it
   * gets wrong ends up in the shipped IR. A Windows ESM frame is
   * 'file:///C:/Users/alice/proj/src/wf.ts' while process.cwd() is
   * 'C:\\Users\\alice\\proj': neither the separators nor the drive-letter slash
   * line up, so the path stayed absolute and the author's home directory rode
   * along into every deploy.
   */
  test('a Windows file URL relativizes against a backslash cwd', () => {
    expect(normalizeFile('file:///C:/Users/alice/proj/src/wf.ts', 'C:\\Users\\alice\\proj')).toBe(
      'src/wf.ts'
    );
  });

  test('a drive letter matches whichever case the platform reported it in', () => {
    expect(normalizeFile('file:///C:/Users/alice/proj/src/wf.ts', 'c:\\Users\\alice\\proj')).toBe(
      'src/wf.ts'
    );
  });

  test('a POSIX file URL and a bare path both relativize', () => {
    expect(normalizeFile('file:///home/alice/proj/src/wf.ts', '/home/alice/proj')).toBe(
      'src/wf.ts'
    );
    expect(normalizeFile('/home/alice/proj/src/wf.ts', '/home/alice/proj')).toBe('src/wf.ts');
  });

  test('percent-escapes are decoded and http(s) URLs pass through', () => {
    expect(normalizeFile('file:///home/alice/my%20proj/src/wf.ts', '/home/alice/my proj')).toBe(
      'src/wf.ts'
    );
    // Vite dev serves modules over http; there is no cwd to relativize against
    expect(normalizeFile('http://localhost:5173/src/wf.ts', '/home/alice/proj')).toBe(
      'http://localhost:5173/src/wf.ts'
    );
  });
});

describe('personalization refs are unaffected', () => {
  test('a props object spreading u.xxx compiles as before', () => {
    const ir = workflow('refs', { trigger: trigger.event(e.login) })
      .sendEvent(e.purchase, { value: 1, currency: u.email })
      .toIR();
    const node = ir.flow[0];
    if (node.type !== 'send_event') throw new Error('expected send_event');
    expect(node.payload.currency).toEqual({ type: 'user_property', path: 'email' });
  });
});
