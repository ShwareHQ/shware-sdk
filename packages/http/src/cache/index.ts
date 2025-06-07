interface Props<T extends (...args: any[]) => any> {
  name: string;
  key: (...args: Parameters<T>) => string;
  condition?: (...args: Parameters<T>) => boolean;
  fn: T;
}

export function cache<T extends (...args: any[]) => any>(props: Props<T>) {}
