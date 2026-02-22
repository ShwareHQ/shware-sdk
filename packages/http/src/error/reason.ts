// oxlint-disable-next-line typescript/no-empty-object-type
export interface ErrorReason {}

export type ResolvedErrorReason = keyof ErrorReason extends never ? string : keyof ErrorReason;
