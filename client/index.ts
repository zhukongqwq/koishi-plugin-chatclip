import { Context } from '@koishijs/client'
import Page from './page.vue'

import 'virtual:uno.css'

export default (ctx: Context) => {
  ctx.page({
    name: '聊天收藏',
    path: '/chatclip',
    icon: 'clipboard',
    component: Page,
  })
}
