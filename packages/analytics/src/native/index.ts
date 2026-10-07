export { getDeviceId, getDeviceType, getTags, storage } from './setup';
export { deepLink } from './deep-link';
export { useAppAnalytics } from '../hooks/use-app-analytics';
export { getDeterministicFingerprint, getProbabilisticFingerprint } from './fingerprint';

export type { DeterministicFingerprint, ProbabilisticFingerprint } from './fingerprint';
