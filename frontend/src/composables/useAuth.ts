import { ref } from 'vue'
import { apiAuthMe, apiLogin, apiLogout, apiRegister, type AuthUser } from '../api/auth'
import { clearMemoryIdentity, setMemoryUserId, startNewMemoryThread } from '../utils/identity'

export function useAuth() {
  const user = ref<AuthUser | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  function accept(next: AuthUser) {
    user.value = next
    setMemoryUserId(next.id)
    startNewMemoryThread()
    error.value = null
  }

  async function checkMe() {
    loading.value = true
    try {
      accept((await apiAuthMe()).user)
    } catch {
      user.value = null
    } finally {
      loading.value = false
    }
  }

  async function login(username: string, password: string) {
    error.value = null
    try { accept((await apiLogin(username, password)).user) } catch (e) { error.value = e instanceof Error ? e.message : '登录失败'; throw e }
  }

  async function register(username: string, password: string) {
    error.value = null
    try { accept((await apiRegister(username, password)).user) } catch (e) { error.value = e instanceof Error ? e.message : '注册失败'; throw e }
  }

  async function logout() {
    try { await apiLogout() } finally {
      user.value = null
      clearMemoryIdentity()
    }
  }

  return { user, loading, error, checkMe, login, register, logout }
}

