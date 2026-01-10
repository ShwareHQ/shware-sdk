import { hasText } from '@shware/utils';
import { _default, coerce, int, maximum, minimum, object, optional, string } from 'zod/mini';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Empty = {};
export type EntityId = string | number;
export type Entity = { id: EntityId };

export type Response<T = never> = { data: T };

export type InitParams = { limit: number; parent?: string };
export type NextParams = { limit: number; parent?: string; next: string };
export type PrevParams = { limit: number; parent?: string; prev: string };
export type PageParams = { limit: number; prev?: string; next?: string };
export type ParentPageParams = { limit: number; parent: string; prev?: string; next?: string };
export type Page<T = never> = { data: T[]; paging: { next: string; prev: string } };

export function pageParamsSchema(max = 100, defaultLimit = 20) {
  return object({
    limit: _default(coerce.number().check(int(), minimum(1), maximum(max)), defaultLimit),
    prev: optional(string()),
    next: optional(string()),
  });
}

export const Cursor = {
  of(prev: bigint | number | string | undefined, next: bigint | number | string | undefined) {
    return { prev: prev ? this.encode(prev) : '', next: next ? this.encode(next) : '' };
  },
  empty() {
    return { prev: '', next: '' };
  },
  encode(id: bigint | number | string): string {
    return Buffer.from(id.toString(), 'utf-8').toString('base64');
  },
  decode<T extends 'bigint' | 'number' | 'string' = 'bigint'>(
    token: string,
    type: T = 'bigint' as T
  ): T extends 'bigint' ? bigint : T extends 'number' ? number : string {
    const value = Buffer.from(token, 'base64').toString('utf-8');
    if (type === 'bigint')
      return BigInt(value) as T extends 'bigint' ? bigint : T extends 'number' ? number : string;
    if (type === 'number')
      return Number(value) as T extends 'bigint' ? bigint : T extends 'number' ? number : string;
    return value as T extends 'bigint' ? bigint : T extends 'number' ? number : string;
  },
};

export const initialPageParam: Omit<PageParams, 'limit'> = { next: '', prev: '' };

export function getPreviousPageParam<T = never>(first: Page<T>): Omit<PageParams, 'limit'> | null {
  return hasText(first.paging.prev) ? { next: '', prev: first.paging.prev } : null;
}

export function getNextPageParam<T = never>(last: Page<T>): Omit<PageParams, 'limit'> | null {
  return hasText(last.paging.next) ? { next: last.paging.next, prev: '' } : null;
}
