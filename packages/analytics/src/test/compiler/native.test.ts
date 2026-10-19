import type { AppState as HostAppState } from 'react-native';

// The DOM renderer exercises the real native hook; only the native host's subscription port
// is replaced. These tests navigate screens without sending native background events.
export const AppState: Pick<typeof HostAppState, 'addEventListener'> = {
  addEventListener: () => ({ remove() {} }),
};
