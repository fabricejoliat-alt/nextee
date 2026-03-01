"use client";

type CacheEnvelope<T> = {
  ts: number;
  value: T;
};

const mem = new Map<string, CacheEnvelope<unknown>>();

function safeSessionStorageGet(key: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionStorageSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

function safeSessionStorageRemove(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

export function readClientPageCache<T>(key: string, ttlMs: number): T | null {
  const now = Date.now();

  const fromMem = mem.get(key) as CacheEnvelope<T> | undefined;
  if (fromMem && now - fromMem.ts <= ttlMs) {
    return fromMem.value;
  }

  const raw = safeSessionStorageGet(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.ts !== "number") return null;
    if (now - parsed.ts > ttlMs) return null;
    mem.set(key, parsed as CacheEnvelope<unknown>);
    return parsed.value;
  } catch {
    return null;
  }
}

export function writeClientPageCache<T>(key: string, value: T) {
  const envelope: CacheEnvelope<T> = {
    ts: Date.now(),
    value,
  };
  mem.set(key, envelope as CacheEnvelope<unknown>);
  safeSessionStorageSet(key, JSON.stringify(envelope));
}

export function invalidateClientPageCache(key: string) {
  mem.delete(key);
  safeSessionStorageRemove(key);
}

export function invalidateClientPageCacheByPrefix(prefix: string) {
  Array.from(mem.keys())
    .filter((k) => k.startsWith(prefix))
    .forEach((k) => mem.delete(k));

  if (typeof window === "undefined") return;
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(prefix)) toDelete.push(key);
    }
    toDelete.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // ignore storage failures
  }
}

