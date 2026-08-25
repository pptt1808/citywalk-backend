type CacheEntry<T> = { value: T; expiresAt: number };

const DEFAULT_MAX_ENTRIES = 500;

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency so eviction drops least-recently-used entries first.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.evictIfNeeded();
  }

  clear(): void {
    this.store.clear();
  }

  private evictIfNeeded(): void {
    if (this.store.size <= this.maxEntries) return;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (this.store.size <= this.maxEntries) break;
      if (entry.expiresAt <= now) this.store.delete(key);
    }
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }
}

export const cache = new MemoryCache();
