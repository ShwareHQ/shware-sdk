import offer from './offer';
import welcome from './welcome';

/**
 * Email registry: the single place templates are registered. Each is sent as
 * `email.<name>` and identified by its own `id`; sending a template that is
 * not here fails the compile, naming the workflow and node.
 */
export const email = {
  welcome,
  offer,
} as const;
