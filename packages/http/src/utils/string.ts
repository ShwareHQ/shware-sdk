/**
 * Check whether the given String contains actual text.
 * */
export function hasText(str: string | null | undefined): str is string {
  return typeof str === 'string' && str.trim().length !== 0;
}
