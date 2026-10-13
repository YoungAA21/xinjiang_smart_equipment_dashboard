<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LockKeyhole, UserRound } from 'lucide-vue-next'
import { api } from '../services/api'
import { auth } from '../services/auth'

const route = useRoute()
const router = useRouter()

const form = reactive({
  username: 'dashu',
  password: 'dszn1988',
})
const loading = ref(false)
const errorMessage = ref('')

const canSubmit = computed(() => form.username.trim() && form.password)

const submit = async () => {
  if (!canSubmit.value || loading.value) return

  loading.value = true
  errorMessage.value = ''

  try {
    const session = await api.login({
      username: form.username.trim(),
      password: form.password,
    })
    auth.setSession(session.token, session.userInfo)
    router.replace(route.query.redirect || '/')
  } catch (error) {
    errorMessage.value = error?.message || '登录失败，请检查账号和密码'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="factory-login">
    <section class="factory-visual" aria-label="新疆卷烟厂">
      <img class="factory-photo" src="/login/xinjiang-factory.png" alt="新疆卷烟厂厂区大门" fetchpriority="high" />
      <div class="factory-shade"></div>
      <header class="factory-brand">
        <span class="brand-mark"></span>
        <div><p>新疆卷烟厂</p><h1>智能设备健康管理平台</h1></div>
      </header>
    </section>
    <section class="factory-login-panel">
      <div class="factory-form-wrap">
      <header class="factory-form-heading"><h2>账号登录</h2></header>

      <form class="login-form" autocomplete="off" @submit.prevent="submit">
        <label>
          <span>账号</span>
          <div>
            <UserRound :size="17" />
            <input
              v-model="form.username"
              name="login_account"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="请输入账号"
            />
          </div>
        </label>

        <label>
          <span>密码</span>
          <div>
            <LockKeyhole :size="17" />
            <input
              v-model="form.password"
              name="login_secret"
              type="password"
              autocomplete="new-password"
              autocapitalize="off"
              spellcheck="false"
              placeholder="请输入密码"
            />
          </div>
        </label>

        <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>

        <button type="submit" :disabled="!canSubmit || loading">
          {{ loading ? '登录中...' : '登录系统' }}
        </button>
      </form>
      </div>
    </section>
  </main>
</template>

<style scoped>
.factory-login { display:grid; grid-template-columns:minmax(0,1fr) clamp(400px,30vw,560px); width:100vw; height:100dvh; overflow:auto; background:#101b18; color:#eff6f3; }
.factory-visual { position:relative; min-height:0; overflow:hidden; background:#8aacc2; }
.factory-photo { display:block; width:100%; height:100%; object-fit:cover; object-position:50% 50%; }
.factory-shade { position:absolute; inset:0; background:linear-gradient(180deg,rgba(9,29,35,.66),transparent 27%,transparent 72%,rgba(10,27,26,.32)); pointer-events:none; }
.factory-brand { position:absolute; top:clamp(28px,5vh,64px); left:clamp(28px,4vw,72px); right:24px; display:flex; align-items:center; gap:18px; text-shadow:0 2px 15px #12292166; }
.factory-brand .brand-mark { width:5px; height:62px; min-width:5px; border-radius:3px; background:#a8dbbd; box-shadow:none; }
.factory-brand p { margin:0 0 10px; font-size:18px; font-weight:500; letter-spacing:4px; color:#eef6f3; }
.factory-brand h1 { margin:0; font-size:clamp(24px,2.2vw,40px); line-height:1.4; font-weight:600; letter-spacing:2px; }
.factory-login-panel { display:flex; align-items:center; justify-content:center; padding:48px clamp(32px,3.5vw,68px); background:linear-gradient(155deg,#192c25,#101b18 65%); border-left:1px solid #bad8c622; }
.factory-form-wrap { width:100%; max-width:380px; }
.factory-form-heading { margin-bottom:42px; }
.factory-form-heading h2 { margin:0; font-size:30px; font-weight:600; letter-spacing:2px; color:#f0f6f2; }
.login-form { display:grid; gap:25px; }
.login-form label { gap:11px; color:#c2d4cc; font-size:15px; }
.login-form label > div { height:54px; padding:0 16px; border:1px solid #c6dcd32e; border-radius:8px; background:#ffffff06; box-shadow:none; gap:12px; }
.login-form label > div:focus-within { border-color:#93c5ab; box-shadow:0 0 0 3px #93c5ab18; }
.login-form svg { color:#98b4a6; flex:none; }
.login-form input { width:100%; min-width:0; font-size:16px; color:#eff6f3; }
.login-form input::placeholder { color:#789184; }
.login-form button { height:54px; margin-top:13px; border:1px solid #98c5a8; border-radius:8px; background:#a9d0b5; color:#152c20; box-shadow:0 8px 24px #0002; font-size:17px; font-weight:600; letter-spacing:3px; }
.login-form button:not(:disabled):hover { background:#bfe0c9; box-shadow:0 10px 26px #0003; transform:translateY(-1px); }
.login-form button:focus-visible { outline:2px solid #eff6f3; outline-offset:4px; }
.login-form button:disabled { opacity:.5; cursor:default; }
.login-form p { margin:0; color:#f2a392; font-size:14px; }
:global(body:has(.factory-login)) { min-width:0; }
@media(max-width:800px) {
  .factory-login { grid-template-columns:minmax(0,1fr); grid-template-rows:38vh minmax(430px,1fr); }
  .factory-photo { object-position:center 40%; }
  .factory-brand { top:24px; left:24px; gap:12px; }
  .factory-brand p { font-size:14px; margin-bottom:4px; }
  .factory-brand h1 { font-size:24px; letter-spacing:0; }
  .factory-brand .brand-mark { height:48px; }
  .factory-login-panel { padding:32px 28px 40px; border-left:0; }
  .factory-form-heading { margin-bottom:24px; }
  .factory-form-heading h2 { font-size:25px; }
  .login-form { gap:20px; }
}
</style>
