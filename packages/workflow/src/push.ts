import type { ScalarIR } from './ir';

/**
 * `@shware/workflow/push` — push-notification content. A push is data, not a
 * component: a title and a body the OS renders in its own chrome, with
 * `{prop}` placeholders filled from the message props at send time (the same
 * rule the studio previews with). Transport is a separate concern
 * (`@shware/workflow/fcm`).
 */

/** One entry of the push registry (`src/pushes/index.ts`): the same shape the studio's PushModule declares. */
export interface PushRegistryModule {
  title?: string;
  body?: string;
  /** Rich image URL (iOS attachment / Android BigPicture). */
  image?: string;
}

export interface RenderedPush {
  title: string;
  body: string;
  image?: string;
}

export type PushRenderer = (
  template: string,
  props: Record<string, ScalarIR | undefined>
) => Promise<RenderedPush>;

// A single-brace placeholder; `{{ user.x }}` (the subject syntax) is left for the profile filler.
const PLACEHOLDER = /(?<!\{)\{\s*([A-Za-z_][\w.]*)\s*\}(?!\})/g;

/** Fill `{prop}` placeholders from the resolved props; a missing prop renders empty rather than leaking the placeholder. */
export function fillProps(template: string, props: Record<string, ScalarIR | undefined>): string {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    const value = props[name];
    return value === undefined ? '' : String(value);
  });
}

/** A renderer over the registry: key → module, placeholders filled. */
export function registryPushRenderer(pushes: Record<string, PushRegistryModule>): PushRenderer {
  return async (key, props) => {
    if (!Object.hasOwn(pushes, key)) throw new Error(`unknown push template: ${key}`);
    const mod = pushes[key];
    return {
      title: fillProps(mod.title ?? '', props),
      body: fillProps(mod.body ?? '', props),
      ...(mod.image === undefined ? {} : { image: fillProps(mod.image, props) }),
    };
  };
}
