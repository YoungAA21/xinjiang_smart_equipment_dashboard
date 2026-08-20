import { createApp } from 'vue'
import { createPinia } from 'pinia'
import {
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElInputNumber,
  ElOption,
  ElPagination,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElTag,
} from 'element-plus'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'
import { router } from './router'

const app = createApp(App)

;[
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElInputNumber,
  ElOption,
  ElPagination,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElTag,
].forEach((component) => {
  app.component(component.name, component)
})

app.use(createPinia()).use(router).mount('#app')
