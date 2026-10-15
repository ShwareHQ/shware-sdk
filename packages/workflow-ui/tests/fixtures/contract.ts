import { defineContract } from '@shware/workflow';
import * as z from 'zod/mini';

/** The fixtures' shared contract: one event, one profile field. */
export const contract = defineContract({
  events: { sign_up: z.looseObject({}) },
  profile: z.strictObject({ email: z.optional(z.string()) }),
});
