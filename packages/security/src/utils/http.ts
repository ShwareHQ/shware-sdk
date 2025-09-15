import { type SerializeOptions, parse, serialize } from 'cookie';
import { match } from 'path-to-regexp';

export type CookieOptions = Omit<SerializeOptions, 'encode'>;

export function getCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return undefined;
  const parsed = parse(cookie);
  return parsed[name];
}

export function setCookie(
  response: Response,
  name: string,
  value: string,
  options?: SerializeOptions
) {
  response.headers.append('Set-Cookie', serialize(name, value, options));
}

export function deleteCookie(response: Response, name: string, options?: SerializeOptions) {
  response.headers.append('Set-Cookie', serialize(name, '', { ...options, maxAge: 0 }));
}

type PathParam<T extends string> = T extends `${string}:${infer Param}/${infer Rest}`
  ? { [K in Param]: string } & PathParam<Rest>
  : T extends `${string}:${infer Param}`
    ? { [K in Param]: string }
    : {};

export function param<P extends string>(request: Request, path: P): PathParam<P> {
  const url = new URL(request.url);
  const fn = match(path);
  const result = fn(url.pathname);
  if (!result) throw new Error(`Path not matched: ${url.pathname}, path: ${path}`);
  return result.params as PathParam<P>;
}

export function query(request: Request) {
  const url = new URL(request.url);
  return Object.fromEntries(url.searchParams.entries());
}
