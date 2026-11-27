import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
import { afterAll, beforeAll, describe } from 'vitest';
import { awsDriver } from './aws-driver';
import { conformance } from './suite';

describe('aws', () => {
  // The runner's environment, and its clock (`skipTime`), for the file
  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  }, 30_000);
  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });
  conformance(awsDriver);
});
