import { BookmarksOutline } from '@vicons/ionicons5'
import { Context, icons } from '@koishijs/client'
import Page from './page.vue'

import 'virtual:uno.css'

// 控制台内置图标集里没有合适的一个，这里注册 Ionicons（@vicons/ionicons5）里的书签图标，
// 侧边栏和页面标题都会用它。
icons.register('chatclip', BookmarksOutline)

export default (ctx: Context) => {
  ctx.page({
    name: '聊天收藏',
    path: '/chatclip',
    icon: 'chatclip',
    component: Page,
  })
}
