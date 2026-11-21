import { Context } from 'koishi'
import { resolve } from 'path'
import { Config } from './config'
import { applyTables } from './db'
import { applyCommands } from './commands'
import { applyConsole } from './console'

import './types'

export const name = 'chatclip'

export * from './config'
export { Config } from './config'

export const inject = {
  required: ['database'],
  optional: ['assets', 'puppeteer', 'console'],
}

export const usage = `
引用一条消息后发送 \`/clip\` 即可收藏；\`/clip list\` 查看收藏夹，\`/clip show 编号\` 渲染单条。
- 图片需要 \`assets\` 插件（assets-local / assets-s3 均可）；
- 图片渲染需要 \`puppeteer\` 插件，未启用时自动降级为文字。`

export function apply(ctx: Context, config: Config) {
  // loader 是在 apply 返回“之后”才安装 $filter 包装的，所以除了当场探测，
  // 还要在下一个 tick 和 ready 时各复查一次（见 protectFilter 的注释）。
  protectFilter(ctx)
  ctx.setTimeout(() => protectFilter(ctx), 0)
  ctx.on('ready', () => protectFilter(ctx))

  applyTables(ctx)
  applyCommands(ctx, config)

  ctx.inject(['console'], (ctx) => {
    applyConsole(ctx, config)
    const prod = resolve(__dirname, '../dist')
    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod,
    })
    // 控制台只在 prod 模式下按路径前缀校验静态资源，工作区软链接的插件会被判为越界（403）
    if (process.env.NODE_ENV !== 'development' && !prod.includes('node_modules')) {
      ctx.logger('chatclip').warn(
        '当前以工作区软链接方式加载 chatclip，控制台前端在 prod 模式下会返回 403。'
        + ' 本地调试请用 `yarn dev`（NODE_ENV=development）启动；发布安装后不受影响。',
      )
    }
  })

  ctx.inject(['assets'], (ctx) => {
    const selfUrl = (ctx.assets as any).config?.selfUrl ?? (ctx.assets as any).selfUrl
    if (!selfUrl) {
      ctx.logger('chatclip').warn(
        'assets 未配置 selfUrl，转存后的图片会变成 file:// 地址，聊天平台可能无法显示。'
        + ' 请在 assets-local 配置里补上 selfUrl（例如 http://localhost:5140）。',
      )
    } else if (String(selfUrl).startsWith('file://')) {
      ctx.logger('chatclip').warn('assets 的 selfUrl 是 file:// 地址，聊天平台可能无法显示图片。')
    }
  })

  ctx.inject(['puppeteer'], (ctx) => {
    ctx.logger('chatclip').info('puppeteer 已就绪，收藏可以用图片渲染。')
  })
}

/**
 * koishi 的 loader 在应用插件时会安装一层 `$filter` 包装：
 * `fork.parent.filter = (session) => parent.filter(session) && ...`（@koishijs/loader/src/shared.ts:350）。
 * 某些重载路径（控制台改配置、HMR、插件被反复 apply）会让包装指向自身，
 * 于是任意一次 `ctx.filter(session)` 都会栈溢出，表现为命令解析时抛出
 * `RangeError: Maximum call stack size exceeded`。命令的 `match()` 恰好会调用
 * `cmd.ctx.filter(session)`，所以这里先探测一次，发现自引用就回退成「不过滤」。
 */
export function protectFilter(ctx: Context) {
  const probe = { resolve: () => true } as any
  try {
    ;(ctx as any).filter(probe)
  } catch (error: any) {
    if (!(error instanceof RangeError)) return
    ;(ctx as any).filter = () => true
    ctx.logger('chatclip').warn(
      '检测到插件上下文的 filter 包装自引用（loader $filter），已回退为不过滤。',
      ' 这通常是控制台改配置或 HMR 重载插件后遗留的问题，重启 koishi 也能消除。',
    )
  }
}
