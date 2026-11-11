/**
 * Runtime options — how the engine should behave in a given environment, as
 * typed configuration rather than loose environment variables. A project keeps
 * one `JourneyRuntimeConfig` (typically in its `workflow.config.ts`, next to the
 * studio settings) with one entry per mode; the host resolves the entry for
 * the environment it is running in and hands it to the runner.
 *
 * The only thing that should come from the environment is the mode itself —
 * which entry applies — never the values.
 */

export interface JourneyRuntimeOptions {
  /**
   * Fast-forward factor for every duration in a journey — delays, random
   * delays, wait timeouts, goal and `performed(within)` windows scale
   * together (see engine/time-scale.ts). 3600 turns "2 days" into 48 s.
   * 1 (the default) is real time; anything else belongs to development only:
   * the `production` entry's type admits no other value (`ProductionRuntimeOptions`).
   */
  timeScale?: number;
  /** Log every outbound message (channel, template, recipient, resolved props) as it is sent. */
  logMessages?: boolean;
}

/**
 * The `production` entry: real time, in the type. A fast-forwarded production (every delay,
 * goal window and segment window of every user compressed alike, a week of journey mail in
 * minutes) has only ever been a slip — a `development` entry pasted under the wrong key, a
 * factor left in after a rehearsal — so `timeScale` here is `1` or absent, and the slip is a
 * compile error where it is written rather than a flood of messages where it runs. A deploy that
 * is meant to run fast is not production: give it a mode of its own (`ENVIRONMENT=rehearsal`),
 * which is as free as `development`.
 */
export type ProductionRuntimeOptions = Omit<JourneyRuntimeOptions, 'timeScale'> & { timeScale?: 1 };

/** Environments a project distinguishes; any string works, these two are the conventional ones. */
export type JourneyMode = 'development' | 'production' | (string & {});

/**
 * One options entry per mode. Missing modes run with the defaults (real time, quiet). Only
 * `production` is held to real time; a mode under any other name is as free as `development`.
 */
export type JourneyRuntimeConfig = {
  [mode in JourneyMode]?: mode extends 'production'
    ? ProductionRuntimeOptions
    : JourneyRuntimeOptions;
};

const DEFAULTS: Required<JourneyRuntimeOptions> = { timeScale: 1, logMessages: false };

/** The options for `mode`, defaults filled in; `config` may be absent altogether. */
export function resolveRuntime(
  config: JourneyRuntimeConfig | undefined,
  mode: JourneyMode
): Required<JourneyRuntimeOptions> {
  const entry = config?.[mode] ?? {};
  const timeScale = entry.timeScale ?? DEFAULTS.timeScale;
  return {
    timeScale: Number.isFinite(timeScale) && timeScale > 0 ? timeScale : DEFAULTS.timeScale,
    logMessages: entry.logMessages ?? DEFAULTS.logMessages,
  };
}
