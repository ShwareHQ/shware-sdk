import { v7 as uuidv7 } from 'uuid';

export type Session = { id: string; lastActiveTime: number };
const session: Session = { id: uuidv7(), lastActiveTime: Date.now() };

export function updateSessionActiveTime() {
  session.lastActiveTime = Date.now();
  return session;
}

export function resetSession() {
  session.id = uuidv7();
  session.lastActiveTime = Date.now();
  return session;
}
