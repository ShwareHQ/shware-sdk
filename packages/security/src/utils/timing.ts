interface Timer {
  description?: string;
  start: number;
}

interface Options {
  enabled: boolean;
  crossOrigin?: string;
}

export function timing({ enabled, crossOrigin }: Options) {
  let start = performance.now();
  const headers: string[] = [];
  const timers = new Map<string, Timer>();

  return {
    startTime: (name: Lowercase<string>, description?: string) => {
      timers.set(name, { description, start: performance.now() });
    },
    endTime: (name: Lowercase<string>, precision?: number) => {
      const timer = timers.get(name);
      if (!timer) {
        console.warn(`timing: ${name} not found`);
        return;
      }
      const { start, description } = timer;
      const dur = (performance.now() - start).toFixed(precision ?? 1);
      timers.delete(name);
      const metric = description
        ? `${name};dur=${dur};desc="${description}"`
        : `${name};dur=${dur}`;
      headers.push(metric);
    },
    mark: (name: Lowercase<string>, description?: string, precision?: number) => {
      const dur = (performance.now() - start).toFixed(precision ?? 1);
      const metric = description
        ? `${name};dur=${dur};desc="${description}"`
        : `${name};dur=${dur}`;
      headers.push(metric);
      start = performance.now();
    },
    setMetric: (
      name: Lowercase<string>,
      value: number | string | undefined,
      description?: string,
      precision?: number
    ) => {
      if (typeof value === 'number') {
        const dur = value.toFixed(precision ?? 1);
        const metric = description
          ? `${name};dur=${dur};desc="${description}"`
          : `${name};dur=${dur}`;
        headers.push(metric);
      } else {
        const metric = value ? `${name};desc="${value}"` : `${name}`;
        headers.push(metric);
      }
    },
    setTiming: (response: Response) => {
      if (!enabled) return;
      response.headers.append('Server-Timing', headers.join(','));
      response.headers.append('Timing-Allow-Origin', crossOrigin ?? '*');
    },
  };
}
