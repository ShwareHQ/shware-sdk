export function once<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  let settled = false;
  let cache: T;
  let promise: Promise<T> | null = null;

  return async (...args: A) => {
    if (settled) return cache;
    promise ??= fn(...args)
      .then((result) => {
        cache = result;
        settled = true;
        return result;
      })
      .catch((error: unknown) => {
        promise = null;
        throw error;
      });

    return promise;
  };
}
