import type { SecurityContext, Session } from './types';

export const SPRING_SECURITY_CONTEXT = 'SPRING_SECURITY_CONTEXT';
export const PRINCIPAL_NAME_INDEX_NAME = `org.springframework.session.FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME`;

export function resolveIndexesFor(session: Session): string | null {
  const principalName = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME) as string | null;
  if (principalName !== null) return principalName;

  const jsonString = session.getAttribute(SPRING_SECURITY_CONTEXT);
  if (typeof jsonString === 'string') {
    // The attribute is externally stored JSON, so it may parse to null.
    const context = JSON.parse(jsonString) as SecurityContext | null;
    return context?.authentication?.name ?? context?.authentication?.principal?.name ?? null;
  }
  return null;
}
