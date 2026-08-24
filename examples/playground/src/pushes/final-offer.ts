/**
 * The rich-image variant: `image` becomes the iOS attachment thumbnail and the
 * Android BigPicture. An inline SVG keeps the demo self-contained; a real
 * project would point at a hosted asset.
 */

export const name = 'Winback · Final offer';
export const description = 'Last-call discount push, paired with the final offer email.';

export const title = '{coupon} — 20% off ends in {expiresIn}';
export const body =
  'Your plan is one tap away from being back. The code is already applied at checkout.';

export const image =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='300'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%236366f1'/%3E%3Cstop offset='1' stop-color='%23d946ef'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='600' height='300' fill='url(%23g)'/%3E%3Ctext x='50%25' y='54%25' font-family='sans-serif' font-size='44' font-weight='600' fill='white' text-anchor='middle'%3E20%25 off · 72h%3C/text%3E%3C/svg%3E";
