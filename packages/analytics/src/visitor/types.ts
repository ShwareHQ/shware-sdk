import type { UpdateVisitorDTO } from '../schema';

export type VisitorProperties = Record<Lowercase<string>, string | number | boolean | null>;

/**
 * Hands the user to a third party: `identify` passes the user and the `user_data` it was given,
 * `reset()` no user, which a setter reads as sign-out.
 */
export type ThirdPartyUserSetter = (user: Omit<UpdateVisitorDTO, 'tags'>) => void;
