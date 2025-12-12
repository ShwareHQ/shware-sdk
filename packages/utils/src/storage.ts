export type LocalStorageItemWithExpiry<T = unknown> = { value: T; expiresAt: number };

export const expiringStorage = {
  setItem: <T = unknown>(key: string, value: T, ttlInMs: number) => {
    const now = Date.now();
    const item: LocalStorageItemWithExpiry<T> = { value, expiresAt: now + ttlInMs };
    try {
      localStorage.setItem(key, JSON.stringify(item));
    } catch (error) {
      console.error('Failed to set item with expiry:', error);
    }
  },
  getItem: <T = unknown>(key: string): T | null => {
    const itemStr = localStorage.getItem(key);
    if (!itemStr) return null;

    try {
      const item: LocalStorageItemWithExpiry<T> = JSON.parse(itemStr);
      const now = Date.now();
      if (now > item.expiresAt) {
        localStorage.removeItem(key);
        return null;
      }
      return item.value;
    } catch {
      return null;
    }
  },
};
