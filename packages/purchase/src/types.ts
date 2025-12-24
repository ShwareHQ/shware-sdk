import type { StringValue } from 'ms';

export type Metadata = { credits: number; expiresIn: StringValue };

export type IsUnique<T extends readonly unknown[]> = T extends readonly [infer First, ...infer Rest]
  ? First extends Rest[number]
    ? false
    : IsUnique<Rest>
  : true;
