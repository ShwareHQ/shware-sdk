import { v7 as uuidv7 } from 'uuid';

export type Session = { id: string; lastActiveTime: number };

export const SESSION_TIMEOUT = 30 * 60 * 1000;
const session: Session = { id: uuidv7(), lastActiveTime: Date.now() };

export function updateSessionActiveTime() {
  session.lastActiveTime = Date.now();
}

export function resetSession() {
  session.id = uuidv7();
  session.lastActiveTime = Date.now();
}

export function getCurrentSession() {
  return session;
}

export function isSessionExpired() {
  return Date.now() - session.lastActiveTime > SESSION_TIMEOUT;
}
