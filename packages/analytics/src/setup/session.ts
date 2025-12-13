import { v7 as uuidv7 } from 'uuid';

export const SESSION_TIMEOUT = 30 * 60 * 1000;

class Session {
  private id: string;
  private lastActiveTime: number;

  constructor() {
    this.id = uuidv7();
    this.lastActiveTime = Date.now();
  }

  getId = () => this.id;

  isExpired = () => Date.now() - this.lastActiveTime > SESSION_TIMEOUT;

  updateLastActiveTime = () => {
    this.lastActiveTime = Date.now();
  };

  refresh = () => {
    this.id = uuidv7();
    this.lastActiveTime = Date.now();
  };
}

export const session = new Session();
