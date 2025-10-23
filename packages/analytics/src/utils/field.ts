export function getFirst<T>(field: T | T[] | undefined) {
  if (!field) return undefined;
  if (Array.isArray(field)) return field.at(0);
  return field;
}
