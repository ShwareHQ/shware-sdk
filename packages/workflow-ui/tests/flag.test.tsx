import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { Flag } from '../src/components/flag';

const ready = vi.hoisted(() => {
  function deferred() {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((complete) => {
      resolve = complete;
    });
    return { promise, resolve };
  }
  return { us: deferred(), gb: deferred(), gbStarted: deferred(), gbReturned: deferred() };
});
vi.mock(import('../src/app/assets/flags/US.svg?react'), async () => {
  await ready.us.promise;
  return { default: () => <svg data-country="US" /> };
});
vi.mock(import('../src/app/assets/flags/GB.svg?react'), async () => {
  ready.gbStarted.resolve();
  await ready.gb.promise;
  ready.gbReturned.resolve();
  return { default: () => <svg data-country="GB" /> };
});
afterEach(cleanup);

it('hides a stale flag at commit and ignores a loader resolved after the country changes', async () => {
  const committed = vi.fn<(code: string, flag: string | null | undefined) => void>();
  function Preview({ code }: { code: string }) {
    useLayoutEffect(() => {
      committed(code, document.querySelector('[data-country]')?.getAttribute('data-country'));
    }, [code]);
    return <Flag code={code} />;
  }
  const view = render(<Preview code="us" />);
  await act(async () => ready.us.resolve());
  await waitFor(() => expect(view.container.querySelector('[data-country="US"]')).toBeTruthy());
  view.rerender(<Preview code="gb" />);
  expect(committed).toHaveBeenLastCalledWith('gb', undefined);
  expect(view.container.querySelector('svg')).toBeNull();
  await act(async () => ready.gbStarted.promise);
  view.rerender(<Preview code="unknown" />);
  await act(async () => {
    ready.gb.resolve();
    await ready.gbReturned.promise;
  });
  expect(view.container.querySelector('svg')).toBeNull();
});
