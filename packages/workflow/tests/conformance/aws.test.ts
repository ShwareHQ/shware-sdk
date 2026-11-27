import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
import { afterAll, beforeAll, describe } from 'vitest';
import { awsDriver } from './aws-driver';
import { conformance } from './suite';

/*
 * Not on Linux, and so not in CI. With `skipTime` the local durable runner installs fake
 * timers, and on Linux the first execution run under them never returns: the process grows
 * until it is out of memory (seen on the CI runner, and in a Linux container on Node 24 and
 * 26; never on macOS). Why is not known — it is inside the runner, before any scenario's own
 * code. `aws.test.ts`, which runs everywhere, does not use `skipTime`. Until that is understood
 * this host's conformance is a local run.
 */
const unable = process.platform === 'linux';
if (unable) {
  console.warn(
    '[conformance] aws: skipped on Linux — the local durable runner hangs under skipTime there'
  );
}

describe.skipIf(unable)('aws', () => {
  // The runner's environment, and its clock (`skipTime`), for the file
  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  }, 30_000);
  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });
  conformance(awsDriver);
});
