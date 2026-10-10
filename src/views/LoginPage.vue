<script setup>
import DataModeControl from '../components/DataModeControl.vue'
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LockKeyhole, RadioTower, ScanLine, ShieldCheck, UserRound } from 'lucide-vue-next'
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
  <main class="login-shell">
    <section class="login-visual">
      <div class="login-brandline">
        <span>Equipment Health Command Center</span>
        <strong>智能设备健康监测平台</strong>
        <p>设备状态监测、声纹分析、告警联动与运行趋势统一指挥中心</p>
      </div>

      <div class="login-hologram">
        <div class="login-orbit orbit-a"></div>
        <div class="login-orbit orbit-b"></div>
        <div class="login-core">
          <RadioTower :size="42" />
          <i></i><i></i><i></i>
        </div>
        <div class="login-scan"><ScanLine :size="18" /></div>
      </div>

      <div class="login-stats">
        <article>
          <b>24h</b>
          <span>实时监测</span>
        </article>
        <article>
          <b>AI</b>
          <span>声纹诊断</span>
        </article>
        <article>
          <b>JWT</b>
          <span>安全认证</span>
        </article>
      </div>
    </section>

    <section class="login-panel">
      <div class="login-data-mode"><DataModeControl /></div>
      <header>
        <span><ShieldCheck :size="15" /> 安全登录</span>
        <strong>欢迎回来</strong>
      </header>

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

        <p v-if="errorMessage">{{ errorMessage }}</p>

        <button type="submit" :disabled="!canSubmit || loading">
          {{ loading ? '登录中...' : '登录系统' }}
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.login-data-mode { display: flex; justify-content: flex-end; margin-bottom: 16px; }
</style>
