<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { PhArrowRight, PhCompass, PhKey, PhUserCircle } from '@phosphor-icons/vue'
import type { useAuth } from '../composables/useAuth'

const auth = inject<ReturnType<typeof useAuth>>('auth')!
const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const busy = ref(false)
const localError = ref<string | null>(null)
const remember = ref(true)
const title = computed(() => mode.value === 'login' ? '打开你的城市手账' : '领取一本新手账')
const subtitle = computed(() => mode.value === 'login' ? '登录以同步路线、记忆与沿途故事。' : '从今天起，把每次漫步都收藏起来。')

function switchMode(next: 'login' | 'register') {
  mode.value = next
  localError.value = null
}

async function submit() {
  localError.value = null
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{2,63}$/.test(username.value.trim())) {
    localError.value = '用户名为 3-64 位字母、数字、下划线、点或短横线'
    return
  }
  if (password.value.length < 8) { localError.value = '密码至少需要 8 位'; return }
  busy.value = true
  try {
    if (mode.value === 'login') await auth.login(username.value.trim(), password.value)
    else await auth.register(username.value.trim(), password.value)
  } catch (error) {
    localError.value = error instanceof Error ? error.message : '操作失败，请稍后重试'
  } finally { busy.value = false }
}
</script>

<template>
  <main class="auth-screen">
    <div class="auth-photo" aria-hidden="true" />
    <div class="auth-wash" aria-hidden="true" />
    <section class="auth-story">
      <div class="live-label"><PhCompass :size="15" weight="bold" /> 城市手账正在等待</div>
      <h1>CityWalk<br/>Agent</h1>
      <p>每条巷子都有自己的节奏。<br/>让路线、照片和偶然相遇，成为一本会生长的城市手账。</p>
      <div class="polaroid-note">
        <div class="mini-scene"><span>城市漫游者</span></div>
        <strong>Urban Explorer No. 7,421</strong>
      </div>
    </section>

    <section class="auth-journal">
      <span class="paperclip">⌇</span>
      <header>
          <span class="auth-seal"><PhCompass :size="24" weight="duotone" /></span>
        <div><h2>{{ title }}</h2><p>{{ subtitle }}</p></div>
      </header>
      <div class="auth-tabs">
        <button :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
        <button :class="{ active: mode === 'register' }" @click="switchMode('register')">注册</button>
      </div>
      <form @submit.prevent="submit">
        <label>
          <span>用户名</span>
          <div class="field"><PhUserCircle :size="20" /><input v-model="username" autocomplete="username" placeholder="例如 city_walker" :disabled="busy" /></div>
        </label>
        <label>
          <span>密码</span>
          <div class="field"><PhKey :size="20" /><input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" placeholder="至少 8 位密码" :disabled="busy" /></div>
        </label>
        <div class="form-meta"><label class="remember"><input v-model="remember" type="checkbox" /> 保持登录</label><span>你的内容仅自己可见</span></div>
        <p v-if="localError || auth.error.value" class="auth-error">{{ localError || auth.error.value }}</p>
        <button class="auth-submit" type="submit" :disabled="busy">
          <span>{{ busy ? '正在盖章...' : mode === 'login' ? '进入手账' : '创建账号' }}</span><PhArrowRight v-if="!busy" :size="18" weight="bold" />
        </button>
      </form>
      <p class="switch-copy">{{ mode === 'login' ? '第一次来？' : '已经有一本？' }} <button @click="switchMode(mode === 'login' ? 'register' : 'login')">{{ mode === 'login' ? '领取新手账' : '返回登录' }}</button></p>
    </section>

  </main>
</template>

<style scoped>
.auth-screen { min-height: 100dvh; position: relative; overflow: auto; display: grid; grid-template-columns: minmax(360px, 1fr) minmax(420px, 560px); align-items: center; gap: clamp(40px, 7vw, 110px); padding: clamp(44px, 7vw, 100px); color: #2b211b; isolation: isolate; }
.auth-photo { position: fixed; inset: -2.5%; z-index: -3; background: url('/images/auth-alley.png') center/cover no-repeat; filter: saturate(.88) contrast(.98); transform: scale(1.025); }
.auth-photo::after { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 51% 43%, transparent 0 23%, rgba(38,25,16,.06) 54%, rgba(38,25,16,.2) 100%); }
.auth-wash { position: fixed; inset: 0; z-index: -2; background: linear-gradient(90deg, rgba(252,249,240,.24), rgba(252,249,240,.05) 48%, rgba(252,249,240,.19)); backdrop-filter: blur(.35px); }
.auth-story { align-self: center; text-shadow: 0 1px 20px rgba(252,249,240,.55); }
.live-label { width: fit-content; display:flex; align-items:center; gap:7px; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(155,63,33,.36); background: rgba(255,255,255,.52); color: var(--primary); font: 700 12px var(--font-sans); backdrop-filter: blur(8px); }
.auth-story h1 { margin: 28px 0 22px; color: #9a4100; font: 800 clamp(58px, 6vw, 88px)/.93 var(--font-display); letter-spacing: -.055em; }
.auth-story > p { max-width: 560px; color: rgba(48,35,27,.9); font: 500 clamp(19px, 2vw, 28px)/1.55 var(--font-display); }
.polaroid-note { width: 260px; margin: 38px 0 0 12px; padding: 13px 13px 24px; background: rgba(252,249,240,.86); border: 1px solid rgba(138,114,102,.22); box-shadow: 0 16px 40px rgba(50,30,15,.2); transform: rotate(-2deg); text-align: center; }
.polaroid-note::before { content: ''; position: absolute; width: 90px; height: 25px; margin: -26px 0 0 72px; background: rgba(155,63,33,.16); transform: rotate(2deg); }
.mini-scene { height: 155px; display: grid; place-items: end start; padding: 14px; background: linear-gradient(145deg, rgba(112,72,58,.14), rgba(155,63,33,.2)), url('/images/auth-alley.png') 54% 68%/215% auto; }
.mini-scene span { padding: 5px 9px; border-radius: 999px; background: var(--primary); color: white; font-size: 10px; }
.polaroid-note strong { display: block; margin-top: 18px; color: #8a4d0e; font: 600 14px var(--font-display); }
.auth-journal { width: 100%; padding: clamp(34px, 4vw, 54px); border-radius: 24px; background: rgba(250,247,239,.82); border: 1px solid rgba(255,255,255,.68); box-shadow: 0 30px 80px rgba(49,31,18,.24); backdrop-filter: blur(18px) saturate(.9); position: relative; }
.paperclip { position: absolute; right: 24px; bottom: 16px; color: rgba(138,114,102,.2); font-size: 64px; transform: rotate(16deg); }
.auth-journal header { display: flex; align-items: center; gap: 15px; margin-bottom: 25px; }
.auth-seal { width: 52px; height: 52px; display: grid; place-items: center; flex: 0 0 auto; border: 2px double rgba(155,63,33,.5); border-radius: 50%; color: var(--primary); transform: rotate(-6deg); }
.auth-journal h2 { font: 700 clamp(24px, 3vw, 33px) var(--font-display); color: var(--text-h); }
.auth-journal header p { margin-top: 4px; color: var(--text-muted); font-size: 14px; }
.auth-tabs { display: flex; gap: 6px; padding: 4px; margin-bottom: 24px; border-radius: 999px; background: rgba(229,226,218,.65); }
.auth-tabs button { flex: 1; border: 0; border-radius: 999px; padding: 9px; color: #765f53; background: transparent; cursor: pointer; font-weight: 700; }
.auth-tabs button.active { color: white; background: var(--primary); box-shadow: 0 4px 12px rgba(151,68,0,.22); }
form { display: grid; gap: 19px; }
form > label > span { display: block; margin: 0 0 8px 3px; color: #665248; font-size: 13px; font-weight: 700; }
.field { display: flex; align-items: center; gap: 10px; padding: 0 17px; border: 1px solid rgba(91,68,56,.2); border-radius: var(--radius-control); background: rgba(255,255,255,.68); transition: var(--transition); color:var(--text-muted); }
.field:focus-within { border-color: rgba(151,68,0,.55); box-shadow: 0 0 0 4px rgba(151,68,0,.08); background: rgba(255,255,255,.76); }
.field input { width: 100%; padding: 15px 0; border: 0; outline: 0; background: transparent; color: #291d17; font: 500 15px var(--font-sans); }
.field input::placeholder { color: rgba(86,67,56,.6); }
.form-meta { display: flex; align-items: center; justify-content: space-between; color: #665248; font-size: 12px; }
.remember { display: flex; align-items: center; gap: 7px; }
.remember input { accent-color: var(--primary); }
.auth-error { padding: 9px 12px; border-radius: 10px; color: #93000a; background: rgba(255,218,214,.75); font-size: 12px; }
.auth-submit { width: 100%; display:flex; align-items:center; justify-content:center; gap:8px; padding: 15px; border: 0; border-radius: 999px; color: white; background: var(--primary); font: 800 15px var(--font-sans); cursor: pointer; box-shadow: 0 9px 24px rgba(155,63,33,.22); transition: var(--transition); }
.auth-submit:hover:not(:disabled) { transform: translateY(-2px); background: var(--primary-hover); }
.auth-submit:disabled { opacity: .55; cursor: wait; }
.switch-copy { margin-top: 23px; color: #665248; text-align: center; font-size: 13px; }
.switch-copy button { border: 0; background: transparent; color: var(--primary); font-weight: 800; cursor: pointer; }

@media (max-width: 920px) {
  .auth-screen { display: block; padding: 32px 20px 80px; }
  .auth-story { text-align: center; margin-bottom: 28px; }
  .auth-story h1 { font-size: 52px; }
  .auth-story > p { margin: auto; font-size: 17px; }
  .live-label { margin: auto; }
  .polaroid-note { display: none; }
  .auth-journal { max-width: 540px; margin: auto; transform: none; }
}
</style>
