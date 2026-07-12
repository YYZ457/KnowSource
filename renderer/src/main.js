import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/main.css'

// 提前应用主题，避免初始加载时主题闪烁 (FOUC)
const savedTheme = localStorage.getItem('ks-theme') || 'dark'
document.documentElement.setAttribute('data-theme', savedTheme)

const app = createApp(App)
app.use(createPinia())

// 修复：注册全局错误处理器，避免渲染异常静默丢失
app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue Error]', err?.message || err, info)
}

// 捕获未处理的 Promise rejection
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Rejection]', event.reason?.message || event.reason)
})

app.mount('#app')
