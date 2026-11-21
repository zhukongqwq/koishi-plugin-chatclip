import { Context, Session, h } from 'koishi'
import { Config } from './config'
import { Clip, ClipQuery, Snapshot, TABLES, clipNo, formatClipId, parseClipId, queryClips, resolveClipRef } from './db'
import { collectClip, countMessages, loadClip, persistClip, sourceFromSession } from './collect'
import { buildHtml, renderClip } from './render'
import { renderDetail, renderList, summaryText, truncate } from './render/text'

/** 相对时间（7d / 24h / 30m）或绝对时间（2026-11-01、2026-11-01 08:00）→ Date */
function parseDate(input?: string, endOfDay = false): Date | undefined {
  if (!input) return
  const relative = input.match(/^(\d+)([dhm])$/)
  if (relative) {
    const unit = ({ d: 864e5, h: 36e5, m: 6e4 } as Record<string, number>)[relative[2]]
    return new Date(Date.now() - Number(relative[1]) * unit)
  }
  const normalized = input.replace(' ', 'T')
  const date = new Date(normalized)
  if (!isNaN(date.getTime())) {
    if (endOfDay && !/\d:\d/.test(input)) date.setHours(23, 59, 59, 999)
    return date
  }
  return
}

/** 列表/搜索的可见性范围：默认只看自己的，--here 看本群，--all 看公开 */
function scopeOf(session: Session, options: Record<string, any>, config: Config): ClipQuery {
  const ownerId = String(session.uid ?? session.userId ?? '')
  if (options.all) return { visibility: ['public'] }
  if (options.here) {
    return {
      channelId: String(session.channelId ?? ''),
      visibility: ['channel', 'public'],
    }
  }
  return { ownerId }
}

/** 把若干收藏的快照一次性取回来，按 clipId 分组 */
async function messagesOf(ctx: Context, clips: Clip[]): Promise<Map<number, Snapshot[]>> {
  if (!clips.length) return new Map()
  const rows = await ctx.database.get(
    TABLES.message,
    { clipId: { $in: clips.map((clip) => clip.id) } },
    { sort: { seq: 'asc' } },
  )
  const map = new Map<number, Snapshot[]>()
  for (const row of rows) {
    const list = map.get(row.clipId) ?? []
    list.push(row)
    map.set(row.clipId, list)
  }
  return map
}

export function applyCommands(ctx: Context, config: Config) {
  const logger = ctx.logger('chatclip')

  function checkAccess(session: Session): string | undefined {
    if (session.guildId) {
      if (!config.allowGroup) return '本群未开启聊天记录收藏。'
    } else if (!config.allowPrivate) {
      return '私聊未开启聊天记录收藏。'
    }
    return
  }

  // 注意：根命令不能声明位置参数。[page] 之类的参数会让 koishi 的命令解析停在根命令上，
  // 于是 `clip list` 会把 list 当成根命令的参数（见 @koishijs/core 的 inferCommand）。
  const root = ctx
    .command('clip', '收藏一条聊天记录')
    .alias('收藏')
    .alias('chatclip')
    .alias('fav')
    .option('share', '-s <visibility> 可见性：private / channel / public')
    .option('card', '--card 强制单条卡片')
    .option('bubble', '--bubble 强制气泡总览')
    .option('text', '--text 以文字展示')
    .usage('引用一条消息后发送 clip 即可收藏；clip list 查看收藏夹。')
    .example('clip （引用一条消息）')
    .example('clip -s channel')
    .action(async ({ session, options }) => {
      if (!session) return
      const denied = checkAccess(session)
      if (denied) return denied

      // 被收藏的是「被引用的那条消息」，不是这条 clip 指令本身。
      // 有的适配器只把引用挂在 event.message.quote 上，session.quote 是空的，两个都看。
      const message = session.quote ?? (session.event?.message as any)?.quote
      if (!message) {
        return '请先引用一条消息再发送 clip。'
      }

      const visibility = (options.share ?? config.defaultVisibility) as 'private' | 'channel' | 'public'
      if (!['private', 'channel', 'public'].includes(visibility)) {
        return '可见性只能是 private、channel 或 public。'
      }

      const ownerId = String(session.uid ?? session.userId ?? '')
      if (config.maxClipsPerUser > 0) {
        const owned = await ctx.database.get(TABLES.clip, { ownerId, deletedAt: null }, { fields: ['id'] })
        if (owned.length >= config.maxClipsPerUser) {
          return `收藏已达上限（${config.maxClipsPerUser} 条），请先删除一些。`
        }
      }

      const source = sourceFromSession(session, message, message?.quote)
      const collected = await collectClip(ctx, config, source, visibility)
      const { clip, existing } = await persistClip(ctx, collected)
      const label = formatClipId(clipNo(clip))
      if (existing) {
        return `这条消息已经收藏过了：${label}（clip show ${label} 查看）`
      }
      const tail = collected.degraded.length ? `\n⚠️ 降级：${collected.degraded.join(', ')}` : ''
      return `已收藏 ${label} · ${countMessages(collected.messages)} 条 · ${visibility}\nclip show ${label} 查看${tail}`
    })

  root
    .subcommand('.list [page:number]', '查看收藏列表')
    .option('here', '--here 本群收藏')
    .option('all', '--all 公开收藏')
    .option('from', '--from <user:text> 按发送者筛选')
    .option('since', '--since <date:text> 起始时间')
    .option('until', '--until <date:text> 截止时间')
    .option('image', '--image 渲染为图片')
    .action(async ({ session, options }, page) => {
      if (!session) return
      const size = config.pageSize
      const current = Math.max(1, Number(page) || 1)
      const query: ClipQuery = {
        ...scopeOf(session, options, config),
        from: options.from
          ? String(options.from)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined,
        start: parseDate(options.since),
        end: parseDate(options.until, true),
      }
      const result = await queryClips(ctx, query, current, size)
      if (!result.total) {
        return '📭 这里还没有收藏。引用一条消息发送 clip 试试。'
      }
      const map = await messagesOf(ctx, result.items)
      const items = result.items.map((clip) => ({ clip, messages: map.get(clip.id) ?? [] }))

      if (options.image) {
        const html = buildListCard(items, config, '我的收藏')
        if (ctx.puppeteer) {
          const image = await ctx.puppeteer
            .render(html, async (page, next) => {
              await page.setViewport({ width: config.imageWidth + 72, height: 400, deviceScaleFactor: 2 })
              await page.waitForNetworkIdle()
              return next((await page.$('.card')) ?? undefined)
            })
            .catch((error: any) => {
              logger.warn('list render failed: %s', error?.message ?? error)
              return null
            })
          if (image) return image
        }
      }

      return renderList(items, {
        title: options.all ? '🌍 公开收藏' : options.here ? '🏠 本群收藏' : '📚 我的收藏',
        page: current,
        pageSize: size,
        total: result.total,
      })
    })

  root
    .subcommand('.show <id:string>', '查看一条收藏')
    .option('text', '--text 以文字展示')
    .option('bubble', '--bubble 强制气泡')
    .option('card', '--card 强制卡片')
    .action(async ({ session, options }, id) => {
      if (!session) return
      if (!parseClipId(id)) return '收藏 ID 形如 #A1024 或 1024。'
      const clip = await resolveClipRef(ctx, id)
      if (!clip || clip.deletedAt || !canSee(clip, session, config)) {
        return `找不到收藏 ${formatClipId(parseClipId(id)!)}。`
      }
      const loaded = await loadClip(ctx, clip.id)
      if (!loaded) return `找不到收藏 ${formatClipId(clipNo(clip))}。`
      const { messages, attachments } = loaded
      if (options.text) {
        const text = renderDetail(loaded.clip, messages, attachments.length)
        // 纯文字模式下附件只有 [图片] 占位，图片本身也要发出来
        const images = attachments
          .filter((item) => item.type === 'img' || item.type === 'image')
          .map((item) => item.assetsUrl || item.originalUrl)
          .filter((url) => !!url)
        if (!images.length) return text
        const limited = images.slice(0, 6)
        const rest = images.length - limited.length
        // 平台侧是另一台机器（如 NapCat 在远端），localhost 的资源它拉不到，
        // 所以先自己下载再以 base64 发出；下载失败才退回原始 URL。
        const elements = await Promise.all(limited.map(async (url) => {
          try {
            const file = await ctx.http.file(url)
            return h.image(Buffer.from(file.data as ArrayBuffer), file.type || 'image/png')
          } catch {
            return h.image(url)
          }
        }))
        return [
          rest > 0 ? `${text}\n（还有 ${rest} 张图片未发送）` : text,
          ...elements,
        ]
      }
      const force = options.card ? 'card' : options.bubble ? 'bubble' : undefined
      const result = await renderClip(ctx, config, loaded.clip, messages, force)
      if (result.image) return result.image
      if (result.reason === 'no-puppeteer') {
        logger.info('puppeteer 未启用，降级为文字展示')
      }
      return renderDetail(loaded.clip, messages, attachments.length)
    })

  root
    .subcommand('.search <keyword:text>', '搜索收藏')
    .option('here', '--here 只搜本群')
    .option('all', '--all 只搜公开')
    .option('image', '--image 渲染为图片')
    .action(async ({ session, options }, keyword) => {
      if (!session) return
      if (!keyword) return '用法：clip search 关键词'
      const size = config.pageSize
      const result = await queryClips(ctx, { ...scopeOf(session, options, config), keyword }, 1, size)
      if (!result.total) return `📭 没有找到包含「${truncate(keyword, 20)}」的收藏。`
      const map = await messagesOf(ctx, result.items)
      const items = result.items.map((clip) => ({ clip, messages: map.get(clip.id) ?? [] }))

      if (options.image) {
        const html = buildListCard(items, config, `搜索「${keyword}」`)
        if (ctx.puppeteer) {
          const image = await ctx.puppeteer
            .render(html, async (page, next) => {
              await page.setViewport({ width: config.imageWidth + 72, height: 400, deviceScaleFactor: 2 })
              await page.waitForNetworkIdle()
              return next((await page.$('.card')) ?? undefined)
            })
            .catch(() => null)
          if (image) return image
        }
      }

      return renderList(items, {
        title: `🔍 「${truncate(keyword, 12)}」`,
        page: 1,
        pageSize: size,
        total: result.total,
      })
    })

  root.subcommand('.rm <id:string>', '删除一条收藏').action(async ({ session }, id) => {
    if (!session) return
    if (!parseClipId(id)) return '收藏 ID 形如 #A1024 或 1024。'
    const clip = await resolveClipRef(ctx, id)
    if (!clip) return `找不到收藏 ${formatClipId(parseClipId(id)!)}。`
    const ownerId = String(session.uid ?? session.userId ?? '')
    const isOwner = clip.ownerId === ownerId
    const isAdmin = authorityOf(session) >= 4
    if (!isOwner && !isAdmin) return '只有收藏者本人或管理员可以删除。'
    await ctx.database.set(TABLES.clip, clip.id, { deletedAt: new Date() })
    return `已删除 ${formatClipId(clipNo(clip))}（可恢复）。`
  })

  root
    .subcommand('.export <id:string>', '导出收藏')
    .option('html', '--html 导出 HTML')
    .action(async ({ session, options }, id) => {
      if (!session) return
      if (!parseClipId(id)) return '收藏 ID 形如 #A1024 或 1024。'
      const target = await resolveClipRef(ctx, id)
      if (!target) return `找不到收藏 ${formatClipId(parseClipId(id)!)}。`
      const loaded = await loadClip(ctx, target.id)
      if (!loaded) return `找不到收藏 ${formatClipId(clipNo(target))}。`
      const payload = options.html
        ? buildHtml(loaded.clip, loaded.messages, config)
        : JSON.stringify(
            { ...loaded.clip, messages: loaded.messages, attachments: loaded.attachments },
            null,
            2,
          )
      if (payload.length > 3600) {
        return '导出内容太大，请在控制台「聊天收藏」页面导出。'
      }
      return options.html ? payload : '```json\n' + payload + '\n```'
    })

  // 用子命令而不是 -h：koishi 的短选项占用了 h
  root
    .subcommand('.help', '查看全部指令')
    .alias('h')
    .action(({ session }) => {
      if (!session) return
      return HELP_TEXT
    })
}

export const HELP_TEXT = [
  '📚 chatclip · 聊天记录收藏',
  '',
  '【收藏】',
  'clip                            引用一条消息后发送，收藏它',
  'clip -s channel                 指定可见性：private / channel / public',
  'clip --card | --bubble | --text 收藏后附带指定展示形态',
  '',
  '【浏览】',
  'clip list [页码]                我的收藏（文字）',
  'clip list --image               渲染成图片总览',
  'clip list --here                只看本群',
  'clip list --all                 只看公开',
  'clip list --from 昵称           按发送者筛选，多个用逗号分隔',
  'clip list --since 7d --until 30m  按时间筛选（7d / 24h / 30m / 2026-11-01）',
  'clip show 编号                  渲染单条（大字卡；有合并转发时出气泡）',
  'clip show 编号 --text           以纯文字查看',
  'clip search 关键词              搜索正文',
  'clip export 编号                导出 JSON（--html 导出 HTML）',
  'clip rm 编号                    删除（软删除，管理员或本人）',
  'clip help                       本帮助',
  '',
  '编号形如 #A1024，也可以只写 1024。别名：收藏 / chatclip / fav。',
].join('\n')

/** private 只有本人能看；channel 本群可见；public 谁都能看。 */
export function canSee(clip: Clip, session: Session, config: Config): boolean {
  if (clip.visibility === 'public') return true
  const ownerId = String(session.uid ?? session.userId ?? '')
  if (clip.ownerId === ownerId) return true
  if (clip.visibility === 'channel') {
    return String(session.channelId ?? '') === clip.channelId
  }
  return authorityOf(session) >= 4
}

/** 未加载 database 的 User 表时 session.user 会退化成 never，这里统一兜底。 */
export function authorityOf(session: Session): number {
  return Number((session.user as any)?.authority ?? 0)
}

/** `--image` 时用的总览卡：整页 HTML 交给 puppeteer 渲染 */
function buildListCard(items: { clip: Clip; messages: Snapshot[] }[], config: Config, title: string): string {
  const rows = items
    .map((item) => {
      const main = item.messages.find((message) => message.role === 'main') ?? item.messages[0]
      const name = main?.nickname || main?.username || item.clip.ownerName || '未知'
      const hasForward = item.messages.some((message) => message.role === 'forward')
      return `<div class="li"><span class="lid">${formatClipId(clipNo(item.clip))}</span><span class="lin">${escape(name)}</span><span class="lic">${escape(truncate(summaryText(main?.content, hasForward), 25))}</span></div>`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#eef1f6;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.card{width:${config.imageWidth}px;background:#fff;border-radius:24px;padding:28px 32px;box-shadow:0 8px 28px rgba(31,36,48,.08)}
h1{font-size:22px;margin-bottom:16px;color:#1f2430}
.li{display:flex;gap:12px;align-items:baseline;padding:10px 0;border-top:1px solid #f1f4fa;font-size:17px;color:#344054}
.lid{color:#5b7cfa;font-weight:600;flex:none}
.lin{color:#667085;flex:none;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lic{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#475467}
</style></head><body><div class="card"><h1>${escape(title)}</h1>${rows}</div></body></html>`
}

function escape(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
