import { Context } from 'koishi'
import { Clip, Snapshot } from '../db'
import { Config } from '../config'
import { buildBubble, buildCard } from './html'

export interface RenderResult {
  /** `<img src="data:image/png;base64,…"/>`，可直接交给 session.send */
  image?: string
  /** 渲染失败时的原因，调用方据此降级成文字 */
  reason?: 'no-puppeteer' | 'error'
}

/**
 * 没有转发展开时出单条大字卡（引用只带一层），有转发展开时出气泡总览。
 * 条数按「主消息 + 转发展开」统计，不含引用链（见 GLOSSARY）。
 * 必须自己写 callback：默认 callback 截 body，而 puppeteer 包内 index.html 的 body 是空的。
 */
export async function renderClip(
  ctx: Context,
  config: Config,
  clip: Clip,
  messages: Snapshot[],
  force?: 'card' | 'bubble',
): Promise<RenderResult> {
  if (!ctx.puppeteer) return { reason: 'no-puppeteer' }
  if (!messages.length) return { reason: 'error' }

  const main = messages.find((item) => item.role === 'main') ?? messages[0]
  const quote = messages.find((item) => item.role === 'quote')
  const hasForward = messages.some((item) => item.role === 'forward')
  const single = force ? force === 'card' : !hasForward
  const html = single
    ? buildCard(clip, main, quote, config)
    : buildBubble(clip, messages, config)

  try {
    const image = await ctx.puppeteer.render(html, async (page, next) => {
      await page.setViewport({
        width: config.imageWidth + 72,
        height: 320,
        deviceScaleFactor: 2,
      })
      // 外部资源（头像、图片）加载慢时 waitForNetworkIdle 会超时抛错，
      // 一旦抛出 puppeteer 插件就跳过 page.close()，页面会一直留在浏览器里
      await page.waitForNetworkIdle({ idleTime: 200, timeout: 5000 }).catch(() => {})
      const handle = await page.$('.card')
      return next(handle ?? undefined)
    })
    return { image }
  } catch (error) {
    ctx.logger('chatclip').warn('render failed: %s', (error as Error)?.message ?? error)
    return { reason: 'error' }
  }
}

export function buildHtml(clip: Clip, messages: Snapshot[], config: Config, force?: 'card' | 'bubble') {
  const main = messages.find((item) => item.role === 'main') ?? messages[0]
  const quote = messages.find((item) => item.role === 'quote')
  const hasForward = messages.some((item) => item.role === 'forward')
  const single = force ? force === 'card' : !hasForward
  return single ? buildCard(clip, main, quote, config) : buildBubble(clip, messages, config)
}
