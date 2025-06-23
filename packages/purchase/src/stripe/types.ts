export type ProductId = Lowercase<string>;
export type PriceId = `price_${string}`;

export interface Config {
  returnUrl: string;
  cancelUrl: string;
  successUrl: `${string}?session_id={CHECKOUT_SESSION_ID}`;
  allowPromotionCodes: boolean;
  payments: Record<ProductId, PriceId>;
  subscriptions: Record<ProductId, PriceId>;
}
