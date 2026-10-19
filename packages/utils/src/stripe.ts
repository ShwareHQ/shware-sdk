/**
 * Currencies the Stripe API counts in whole units: `amount: 500` is 500 JPY.
 * reference: https://docs.stripe.com/currencies#zero-decimal
 *
 * ISK and UGX are left out on purpose: Stripe treats them as zero-decimal, but for backwards
 * compatibility the API still represents them as two-decimal values whose decimals are always 00
 * (`amount: 500` charges 5 ISK), so their divisor is 100.
 * reference: https://docs.stripe.com/currencies#special-cases
 */
export const ZERO_DECIMAL_CURRENCIES = [
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
];

/**
 * Currencies the Stripe API counts in thousandths: `amount: 5120` is 5.120 KWD (the last digit
 * must be 0 when charging).
 * reference: https://docs.stripe.com/currencies#three-decimal
 */
export const THREE_DECIMAL_CURRENCIES = ['BHD', 'JOD', 'KWD', 'OMR', 'TND'];

/** How many Stripe API amount units make one unit of `currency` (1, 100 or 1000). */
export function stripeMinorUnits(currency: string) {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.includes(code)) return 1;
  if (THREE_DECIMAL_CURRENCIES.includes(code)) return 1000;
  return 100;
}
