import { describe } from 'vitest';
import { nodeDriver } from './node-driver';
import { conformance } from './suite';

describe('node', () => {
  conformance(nodeDriver);
});
