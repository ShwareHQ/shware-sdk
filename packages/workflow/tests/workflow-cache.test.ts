import { describe, expect, test } from 'vitest';
import { WorkflowCache } from '../src/host/workflow-cache';
import type { WorkflowIR } from '../src/ir';

/** The host's memory of the workflow bodies it has read (`WorkflowCache`). */

const body = (contentHash: string) =>
  ({ id: 'w', contentHash, flow: [{ id: '0' }] }) as never as WorkflowIR;

describe('WorkflowCache', () => {
  test('a body is read from the store once, then answered from memory', async () => {
    const cache = new WorkflowCache();
    let reads = 0;
    const load = async () => {
      reads++;
      return body('a');
    };
    const first = await cache.get('a', load);
    expect(await cache.get('a', load)).toBe(first);
    expect(reads).toBe(1);
  });

  test('a body the store does not have is not remembered: written later, it is found', async () => {
    const cache = new WorkflowCache();
    expect(await cache.get('a', async () => undefined)).toBeUndefined();
    expect(await cache.get('a', async () => body('a'))).toMatchObject({ contentHash: 'a' });
  });

  test('a failed read is not remembered either', async () => {
    const cache = new WorkflowCache();
    await expect(cache.get('a', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(await cache.get('a', async () => body('a'))).toMatchObject({ contentHash: 'a' });
  });

  test('what is kept cannot be changed by a run: every run of the version shares it', async () => {
    const cache = new WorkflowCache();
    const kept = await cache.get('a', async () => body('a'));
    expect(() => {
      (kept as { id: string }).id = 'other';
    }).toThrow(TypeError);
    const [node] = (kept as never as { flow: { id: string }[] }).flow;
    expect(() => {
      if (node !== undefined) node.id = 'other';
    }).toThrow(TypeError);
  });

  test('past its limit the least recently used body goes, and is read again when asked for', async () => {
    const cache = new WorkflowCache(2);
    const reads: string[] = [];
    const load = (hash: string) => async () => {
      reads.push(hash);
      return body(hash);
    };
    await cache.get('a', load('a'));
    await cache.get('b', load('b'));
    await cache.get('a', load('a')); // a is now the more recent
    await cache.get('c', load('c')); // b goes
    await cache.get('a', load('a'));
    await cache.get('b', load('b'));
    expect(reads).toEqual(['a', 'b', 'c', 'b']);
  });
});
