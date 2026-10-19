import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { Flag } from '../src/components/flag';

afterEach(cleanup);

test('unknown country codes have no loader and render nothing on mount or update', () => {
  const { container, rerender } = render(<Flag code="not-a-country" />);
  expect(container.childElementCount).toBe(0);
  rerender(<Flag code="another-unknown" />);
  expect(container.childElementCount).toBe(0);
});
