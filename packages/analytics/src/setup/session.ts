import { v7 as uuidv7 } from 'uuid';

export const SESSION_TIMEOUT = 30 * 60 * 1000;

class Session {
  private id: string;
  private startTime: number;
  private lastActiveTime: number;
  private accumulatedTime: number;

  private active: boolean;
  private visible: boolean;
  private focused: boolean;

  constructor() {
    this.id = uuidv7();
    this.startTime = Date.now();
    this.lastActiveTime = Date.now();
    this.accumulatedTime = 0;

    this.active = true;
    this.visible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
    this.focused = typeof document !== 'undefined' ? document.hasFocus() : true;
  }

  getId = () => this.id;

  isActive = () => this.active;
  isVisible = () => this.visible;
  isFocused = () => this.focused;
  isExpired = () => Date.now() - this.lastActiveTime > SESSION_TIMEOUT;

  updateLastActiveTime = () => {
    this.lastActiveTime = Date.now();
  };

  updateActive = (active: boolean) => {
    this.active = active;
  };

  refresh = () => {
    this.id = uuidv7();
    this.lastActiveTime = Date.now();
  };

  updateAccumulator = () => {
    const now = Date.now();
    if (this.focused && this.visible && this.active) {
      const delta = now - this.startTime;
      if (delta > 0 && delta < SESSION_TIMEOUT) {
        this.accumulatedTime += delta;
      }
    }
    this.startTime = now;
  };

  focus = () => {
    this.updateAccumulator();
    this.updateLastActiveTime();
    this.focused = true;
  };

  blur = () => {
    this.updateAccumulator();
    this.focused = false;
  };

  pageshow = () => {
    this.updateAccumulator();
    this.updateLastActiveTime();
    this.active = true;
  };

  pagehide = () => {
    this.updateAccumulator();
    this.active = false;
  };

  visibilitychange = (state: DocumentVisibilityState) => {
    this.updateAccumulator();
    if (state === 'visible') {
      this.updateLastActiveTime();
    }
    this.visible = state === 'visible';
  };

  flush = () => {
    this.updateAccumulator();
    const engagementTime = this.accumulatedTime;
    this.accumulatedTime = 0;
    return engagementTime;
  };
}

export const session = new Session();
