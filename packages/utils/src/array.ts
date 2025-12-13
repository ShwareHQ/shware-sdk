export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0) throw new Error('size must be greater than 0');
  if (array.length === 0) return [];

  const chunksCount = Math.ceil(array.length / size);
  const result: T[][] = new Array(chunksCount);

  for (let i = 0; i < chunksCount; i++) {
    result[i] = array.slice(i * size, i * size + size);
  }

  return result;
}
