import { invariant } from '@shware/utils';

/**
 * What every store config is declared over, and what its type parameters are inferred from: the
 * prefix of every product id, the plans lowest tier first, the billing periods shortest first. A
 * config with no subscriptions passes empty arrays.
 */
export interface Catalog<NS extends Lowercase<string>, PE extends string, BP extends string> {
  /** The prefix every product id starts with (`io.example` for `io.example.pro.monthly`). */
  namespace: NS;
  /** Every plan, lowest tier first: its level, as Apple orders a subscription group. */
  plans: readonly PE[];
  /** Every billing period, shortest first. */
  billingPeriods: readonly BP[];
}

export function assertCatalog({
  plans,
  billingPeriods,
}: Catalog<Lowercase<string>, string, string>) {
  invariant(new Set(plans).size === plans.length, 'Duplicate plan in plans');
  invariant(
    new Set(billingPeriods).size === billingPeriods.length,
    'Duplicate billing period in billingPeriods'
  );
}

/** Runtime mirror of the template-literal type, for ids built at runtime or cast. */
export function assertInNamespace(namespace: string, productId: string) {
  invariant(
    productId.startsWith(`${namespace}.`),
    `Product ${productId} is not in namespace ${namespace}`
  );
}

/** Runtime mirror of the plan and period unions. */
export function assertDeclared(
  { plans, billingPeriods }: Catalog<Lowercase<string>, string, string>,
  plan: string | null,
  billingPeriod: string | null
) {
  invariant(plan === null || plans.includes(plan), `Plan ${plan} is not in plans`);
  invariant(
    billingPeriod === null || billingPeriods.includes(billingPeriod),
    `Billing period ${billingPeriod} is not in billingPeriods`
  );
}
