import type { CSSProperties } from 'react';

/**
 * Every rounded surface that is not a full pill carries this.
 *
 * A plain border-radius leaves a visible curvature break where the arc meets
 * the straight edge; a superellipse blends the two, which is what the canvas
 * cards already do. Pills (`rounded-full`) are continuous by construction, so
 * they skip it.
 *
 * Cast because `corner-shape` is not in React's CSSProperties yet.
 */
export const superellipse = { cornerShape: 'superellipse(1.2)' } as CSSProperties;
