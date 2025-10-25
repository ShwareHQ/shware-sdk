export interface Lintrk {
  lintrk(event: 'track', params: { conversion_id: number; event_id?: string }): void;

  /** reference: https://www.linkedin.com/help/lms/answer/a6246095 */
  lintrk(event: 'setUserData', params: { email: string }): void;
}

/**
 * LinkedIn Conversion Config:
 * example:
 * {
 *   purchase: 123,
 *   add_to_cart: 456,
 *   add_to_wishlist: 789,
 * }
 */
export type LinkedinConversions = Record<Lowercase<string>, number>;
