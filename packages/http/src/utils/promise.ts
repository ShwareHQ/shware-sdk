export function once<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  let cache: T | null = null;
  let promise: Promise<T> | null = null;

  return async (...args: A) => {
    if (cache !== null) return cache;
    if (!promise) {
      promise = fn(...args)
        .then((result) => {
          cache = result;
          return result;
        })
        .catch((error) => {
          promise = null;
          throw error;
        });
    }

    return promise;
  };
}
