interface Props<A extends unknown[], R> {
  name: string;
  key: (...args: A) => string;
  fn: (...args: A) => R;
  condition?: (...args: A) => boolean;
}

export function cache<A extends unknown[], R>(_props: Props<A, R>) {}
