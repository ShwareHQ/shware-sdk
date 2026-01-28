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
export type Page<T = never> = { data: T[]; paging: { next?: string; prev?: string } };

export function pageParamsSchema(max = 100, defaultLimit = 20) {
  return object({
    limit: _default(coerce.number().check(int(), minimum(1), maximum(max)), defaultLimit),
    prev: optional(string()),
    next: optional(string()),
  });
}

export const Cursor = {
  of(
    prev: bigint | number | string | undefined,
    next: bigint | number | string | undefined
  ): Page['paging'] {
    return {
      prev: prev ? this.encode(prev) : undefined,
      next: next ? this.encode(next) : undefined,
    };
  },
  empty(): Page['paging'] {
    return { prev: undefined, next: undefined };
  },
  encode(id: bigint | number | string | undefined): string | undefined {
    if (!id) return undefined;
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

export const initialPageParam: Page['paging'] = {};

export function getPreviousPageParam<T = never>(first: Page<T>): Page['paging'] | null {
  return hasText(first.paging.prev) ? { prev: first.paging.prev } : null;
}

export function getNextPageParam<T = never>(last: Page<T>): Page['paging'] | null {
  return hasText(last.paging.next) ? { next: last.paging.next } : null;
}

export type InfinitePageData<T> = {
  pages: Array<Page<T>>;
  pageParams: Array<Page['paging']>;
};

export const pages = {
  flatten<T>(data: InfinitePageData<T>): T[] {
    return data.pages.flatMap((page) => page.data);
  },
  dedupe<T extends Entity>(data: InfinitePageData<T>): T[] {
    const seen = new Set<EntityId>();
    const result: T[] = [];
    for (const page of data.pages) {
      for (const item of page.data) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          result.push(item);
        }
      }
    }
    return result;
  },
  prepend<T>(item: T) {
    return (data: InfinitePageData<T> | undefined): InfinitePageData<T> | undefined => {
      if (!data) return data;
      const [first, ...rest] = data.pages;
      if (!first) return { ...data, pages: [{ data: [item], paging: {} }] };
      return { ...data, pages: [{ ...first, data: [item, ...first.data] }, ...rest] };
    };
  },
  append<T>(item: T) {
    return (data: InfinitePageData<T> | undefined): InfinitePageData<T> | undefined => {
      if (!data) return data;
      const pages = data.pages;
      const last = pages[pages.length - 1];
      if (!last) return { ...data, pages: [{ data: [item], paging: {} }] };
      return { ...data, pages: [...pages.slice(0, -1), { ...last, data: [...last.data, item] }] };
    };
  },
  update<T>(updater: T, predicate: (item: T) => boolean) {
    return (data: InfinitePageData<T> | undefined): InfinitePageData<T> | undefined => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          data: page.data.map((item) => (predicate(item) ? updater : item)),
        })),
      };
    };
  },
  updateById<T extends Entity>(updated: T) {
    return this.update<T>(updated, (item) => item.id === updated.id);
  },
  remove<T>(predicate: (item: T) => boolean) {
    return (data: InfinitePageData<T> | undefined): InfinitePageData<T> | undefined => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          data: page.data.filter((item) => !predicate(item)),
        })),
      };
    };
  },
  removeById<T extends Entity>(id: EntityId) {
    return this.remove<T>((item) => item.id === id);
  },
};

export const items = {
  push<T>(newItems: T[]) {
    return (data: T[] | undefined): T[] | undefined => {
      if (!data) return newItems;
      return [...data, ...newItems];
    };
  },
  unshift<T>(newItems: T[]) {
    return (data: T[] | undefined): T[] | undefined => {
      if (!data) return newItems;
      return [...newItems, ...data];
    };
  },
  pushAndDedupe<T extends Entity>(newItems: T[]) {
    return (data: T[] | undefined): T[] | undefined => {
      if (!data) return newItems;
      const seen = new Set<EntityId>();
      const result: T[] = [];
      for (const item of data) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          result.push(item);
        }
      }
      for (const item of newItems) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          result.push(item);
        }
      }
      return result;
    };
  },
  unshiftAndDedupe<T extends Entity>(newItems: T[]) {
    return (data: T[] | undefined): T[] | undefined => {
      if (!data) return newItems;
      const seen = new Set<EntityId>();
      const result: T[] = [];
      for (const item of newItems) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          result.push(item);
        }
      }
      for (const item of data) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          result.push(item);
        }
      }
      return result;
    };
  },
  update<T>(updater: T, predicate: (item: T) => boolean) {
    return (data: T[] | undefined): T[] | undefined => {
      if (!data) return data;
      return data.map((item) => (predicate(item) ? updater : item));
    };
  },
  updateById<T extends Entity>(updated: T) {
    return this.update<T>(updated, (item) => item.id === updated.id);
  },
  remove<T>(predicate: (item: T) => boolean) {
    return (data: T[] | undefined): T[] | undefined => {
      if (!data) return data;
      return data.filter((item) => !predicate(item));
    };
  },
  removeById<T extends Entity>(id: EntityId) {
    return this.remove<T>((item) => item.id === id);
  },
};
