const USER_KEY = 'citywalk.memory.user_id'
const THREAD_KEY = 'citywalk.memory.thread_id'

function getOrCreate(key: string, prefix: string): string {
  const stored = localStorage.getItem(key)
  if (stored) return stored
  const generated = `${prefix}_${crypto.randomUUID()}`
  localStorage.setItem(key, generated)
  return generated
}

export function getMemoryUserId(): string {
  return getOrCreate(USER_KEY, 'anon')
}

export function setMemoryUserId(userId: string): void {
  localStorage.setItem(USER_KEY, userId)
}

export function clearMemoryIdentity(): void {
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(THREAD_KEY)
}

export function getMemoryThreadId(): string {
  return getOrCreate(THREAD_KEY, 'thread')
}

export function startNewMemoryThread(): string {
  const generated = `thread_${crypto.randomUUID()}`
  localStorage.setItem(THREAD_KEY, generated)
  return generated
}
