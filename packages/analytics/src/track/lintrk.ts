export interface Lintrk {
  lintrk(event: 'track', params: { conversion_id: number; event_id?: string }): void;

  /** reference: https://www.linkedin.com/help/lms/answer/a6246095 */
  lintrk(event: 'setUserData', params: { email: string }): void;
}
