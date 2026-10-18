import { type ReactNode, createContext, createElement, useContext } from 'react';
import type { ResolvedEmail } from './email';

/**
 * `@shware/workflow/email-context` — the email being rendered, for its components: the resolved
 * metadata (`resolveEmail`) of the template, so a shared layout renders the unsubscribe link the
 * template resolves to instead of a URL of its own. The renderer (`@shware/workflow/react-email`)
 * and the studio's preview both provide it; the props stay the template's own.
 *
 *   const { unsubscribeUrl } = useEmailContext();
 *   {unsubscribeUrl !== undefined && <Link href={unsubscribeUrl}>Unsubscribe</Link>}
 *
 * Browser-safe: React only — no react-dom/server, no Worker bindings.
 */

const EmailContext = createContext<ResolvedEmail | undefined>(undefined);

export function EmailProvider({
  email,
  children,
}: {
  email: ResolvedEmail;
  children?: ReactNode;
}): ReactNode {
  return createElement(EmailContext.Provider, { value: email }, children);
}

/** The email being rendered; throws outside a render the SDK or the studio provides. */
export function useEmailContext(): ResolvedEmail {
  const email = useContext(EmailContext);
  if (email === undefined) {
    throw new Error(
      'useEmailContext() is called outside an email render: render the template with ' +
        "@shware/workflow/react-email's registryRenderer, or wrap it in <EmailProvider email={resolveEmail(template, config.email)}>"
    );
  }
  return email;
}
