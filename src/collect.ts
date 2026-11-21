import { Context, Element, Session, h } from 'koishi'
import { createHash } from 'crypto'
import { Config } from './config'
import { Clip, ClipMeta, ElementJSON, Role, Snapshot, TABLES, Visibility, nextClipNo } from './db'

const CONTENT_LIMIT = 4000

const MEDIA_LABEL: Record<string, string> = {
  img: '[图片]',
  image: '[图片]',
  video: '[视频]',
  audio: '[语音]',
  record: '[语音]',
  file: '[文件]',
}

export function isMedia(type: string) {
  return type in MEDIA_LABEL
}

export function serialize(el: Element): ElementJSON {
  const attrs: Record<string, any> = { ...el.attrs }
  // 转发的 content 只是展开时的原始素材，展开后就存成独立的消息行了，留着只会把 JSON 撑爆
  if (el.type === 'forward') delete attrs.content
  return {
    type: el.type,
    attrs,
    children: el.children.map((child) => typeof child === 'string' ? child : serialize(child)),
  }
}

export function toElement(json: ElementJSON): Element {
  return h(json.type, { ...json.attrs }, json.children.map((child) => typeof child === 'string' ? child : toElement(child)))
}

export function cloneElements(elements: Element[]): Element[] {
  return elements.map((el) => toElement(serialize(el)))
}

/** 纯文本表示，用于搜索与文字视图。 */
export function elementsText(elements: Element[]): string {
  const parts: string[] = []
  for (const el of elements) {
    if (el.type === 'text') {
      parts.push(el.attrs.content ?? '')
    } else if (el.type === 'at') {
      parts.push(`@${el.attrs.name || el.attrs.id || ''}`)
    } else if (MEDIA_LABEL[el.type]) {
      parts.push(MEDIA_LABEL[el.type])
    } else if (el.type === 'quote') {
      continue
    } else if (el.children?.length) {
      parts.push(elementsText(el.children as Element[]))
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim().slice(0, CONTENT_LIMIT)
}

function walkMedia(elements: Element[], visit: (el: Element) => void) {
  for (const el of elements) {
    if (isMedia(el.type) && (el.attrs.src || el.attrs.url)) visit(el)
    if (el.children?.length) walkMedia(el.children as Element[], visit)
  }
}

export interface PendingAttachment {
  index: number
  type: string
  assetsUrl?: string
  originalUrl: string
  filename?: string
  size?: number
  expired: boolean
  /** 转存被跳过的原因，例如 image-too-large */
  note?: string
}

export interface PendingSnapshot {
  role: Role
  quoteDepth: number
  depth: number
  parentId?: string
  messageId: string
  userId: string
  username: string
  nickname?: string
  avatar?: string
  content: string
  elements: ElementJSON[]
  timestamp: Date
  degraded: string[]
}

export interface CollectedClip {
  platform: string
  channelId: string
  guildId?: string
  messageId: string
  ownerId: string
  ownerName: string
  visibility: Visibility
  degraded: string[]
  meta: ClipMeta
  messages: PendingSnapshot[]
  attachments: PendingAttachment[]
}

function userOf(message: any) {
  const user = message?.user ?? {}
  return {
    userId: String(user.id ?? message?.userId ?? ''),
    username: user.name ?? message?.username ?? '',
    nickname: user.nickname ?? message?.nickname ?? '',
    avatar: user.avatar ?? '',
  }
}

/**
 * 头像地址：适配器直接给了就用；QQ 的消息里通常没有头像字段，
 * 但 qlogo 接口对群成员同样有效，按 QQ 号拼一个就能拿到。
 */
function avatarOf(user: any, userId: string, platform: string): string {
  const direct = user?.avatar || user?.avatarUrl
  if (direct) return String(direct)
  if (platform === 'onebot' && /^\d{5,12}$/.test(userId)) {
    return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=100`
  }
  return ''
}

function timeOf(message: any, fallback: Date): Date {
  const raw = message?.timestamp ?? message?.createdAt
  if (!raw) return fallback
  const date = new Date(raw)
  return isNaN(date.getTime()) ? fallback : date
}

async function persistMedia(ctx: Context, config: Config, el: Element): Promise<Omit<PendingAttachment, 'index'> | null> {
  const url: string = el.attrs.src || el.attrs.url
  if (!url) return null
  const base = { type: el.type, originalUrl: url, expired: false }
  if (!config.storage || !ctx.assets) {
    el.attrs.src = url
    return base
  }
  // data: URL 无法被 assets 二次下载，保留内联形式即可
  if (url.startsWith('data:')) {
    el.attrs.src = url
    return base
  }
  try {
    // 本地转存前先自己量一下体积：超过上限就只留原链接，别把 assets 撑爆
    const isImage = el.type === 'img' || el.type === 'image'
    if (isImage && config.maxLocalImageSize > 0) {
      try {
        const file = await ctx.http.file(url)
        const size = (file.data as ArrayBuffer).byteLength
        if (size > config.maxLocalImageSize * 1024 * 1024) {
          el.attrs.src = url
          return { ...base, size, expired: false, note: 'image-too-large' }
        }
      } catch {
        // 量不出来就照常走 upload，它的失败分支会标 expired
      }
    }
    // assets.upload 内部会自己 ctx.http.file 下载，这里不做二次下载
    const uploaded = await ctx.assets.upload(url, '')
    if (!uploaded) return { ...base, expired: true }
    el.attrs.src = uploaded
    return { ...base, assetsUrl: uploaded }
  } catch {
    return { ...base, expired: true }
  }
}

function segmentToElement(seg: any): Element | null {
  const data = seg?.data ?? {}
  switch (seg?.type) {
    case 'text':
      return data.text ? h.text(data.text) : null
    case 'image':
      return h.image(data.url || data.file || '')
    case 'at':
      return h.at(String(data.qq ?? ''))
    case 'face':
      return h('face', { id: String(data.id ?? '') })
    case 'reply':
      return h.quote(String(data.id ?? ''))
    case 'forward':
      return h('forward', { id: String(data.id ?? ''), content: data.content })
    case 'video':
      return h.video(data.url || data.file || '')
    case 'record':
      return h.audio(data.url || data.file || '')
    case 'file':
      return h('file', { src: data.url || '', title: data.name || data.file || '' })
    case 'json':
      return h('json', { data: data.data ?? '' })
    case 'mface':
      return data.url ? h.image(data.url) : null
    default:
      return seg?.type ? h(seg.type, data) : null
  }
}

function unescapeCQ(text: string) {
  return text
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&amp;/g, '&')
}

export function parseCQ(text: string): Element[] {
  const result: Element[] = []
  const re = /\[CQ:([a-zA-Z_]+)((?:,[^\]]*)?)\]/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match.index > last) result.push(h.text(text.slice(last, match.index)))
    const attrs: Record<string, string> = {}
    for (const part of match[2].split(',').slice(1)) {
      const index = part.indexOf('=')
      if (index < 0) continue
      attrs[part.slice(0, index)] = unescapeCQ(part.slice(index + 1))
    }
    const el = segmentToElement({ type: match[1], data: attrs })
    if (el) result.push(el)
    last = re.lastIndex
  }
  if (last < text.length) result.push(h.text(text.slice(last)))
  return result
}

export function parseSegments(input: any): Element[] {
  if (!input) return []
  if (typeof input === 'string') return parseCQ(input)
  if (!Array.isArray(input)) return []
  const result: Element[] = []
  for (const seg of input) {
    const el = segmentToElement(seg)
    if (el) result.push(el)
  }
  return result
}

function forwardGetter(bot: any) {
  const internal = bot?.internal
  if (!internal) return null
  const fn = internal.getForwardMsg ?? internal.get_forward_msg
  return typeof fn === 'function' ? fn.bind(internal) : null
}

/** 展开合并转发；拿不到时返回 null，由调用方标记降级。 */
export async function expandForward(bot: any, id: string, limit: number): Promise<any[] | null> {
  const fn = forwardGetter(bot)
  if (!fn) return null
  try {
    const result = await fn(id)
    const list = result?.messages ?? result?.data?.messages ?? result
    if (!Array.isArray(list)) return null
    return list.slice(0, limit)
  } catch {
    return null
  }
}

function makeMessageId(elements: Element[], timestamp: Date) {
  const content = elementsText(elements)
  return 'synth:' + createHash('md5').update(`${content}@${timestamp.toISOString()}`).digest('hex').slice(0, 16)
}

interface SnapshotOptions {
  role: Role
  elements: Element[]
  userId: string
  username: string
  nickname?: string
  avatar?: string
  messageId: string
  timestamp: Date
  quoteDepth: number
  /** 合并转发的嵌套层数，main = 0 */
  depth?: number
  parentId?: string
  degraded?: string[]
}

async function buildSnapshot(
  ctx: Context,
  config: Config,
  options: SnapshotOptions,
  attachments: PendingAttachment[],
  index: number,
): Promise<PendingSnapshot> {
  const elements = cloneElements(options.elements)
  const pending: Omit<PendingAttachment, 'index'>[] = []

  const jobs: Promise<void>[] = []
  walkMedia(elements, (el) => {
    jobs.push(persistMedia(ctx, config, el).then((row) => {
      if (row) pending.push(row)
    }))
  })
  await Promise.all(jobs)

  for (const row of pending) attachments.push({ ...row, index })

  const degraded = [...(options.degraded ?? [])]
  for (const row of pending) {
    if (row.note && !degraded.includes(row.note)) degraded.push(row.note)
  }

  return {
    role: options.role,
    quoteDepth: options.quoteDepth,
    depth: options.depth ?? 0,
    parentId: options.parentId,
    messageId: options.messageId,
    userId: options.userId,
    username: options.username,
    nickname: options.nickname,
    avatar: options.avatar,
    content: elementsText(elements),
    elements: elements.map(serialize),
    timestamp: options.timestamp,
    degraded,
  }
}

function forwardOf(elements: Element[]): string[] {
  return elements
    .filter((el) => el.type === 'forward' && el.attrs.id)
    .map((el) => String(el.attrs.id))
}

/** 一次收藏最多展开多少条转发消息，防止超大转发把库撑爆。 */
const MAX_FORWARD_MESSAGES = 200

/** NapCat 会把转发的完整内容塞进段数据的 content 字段，能直接复用就不用再发一次 API。 */
function forwardInline(attrs: any): any[] | undefined {
  const content = attrs?.content
  return Array.isArray(content) && content.length ? content : undefined
}

export interface CollectSource {
  platform: string
  channelId: string
  guildId?: string
  guildName?: string
  channelName?: string
  ownerId: string
  ownerName: string
  bot: any
  /** 要被收藏的那条消息 */
  message: any
  /** 它的直接引用 */
  quote?: any
}

export function sourceFromSession(session: Session, message?: any, quote?: any): CollectSource {
  return {
    platform: session.platform,
    channelId: String(session.channelId ?? ''),
    guildId: session.guildId ? String(session.guildId) : undefined,
    guildName: (session as any).guild?.name,
    channelName: (session as any).channel?.name,
    ownerId: String(session.uid ?? session.userId ?? ''),
    ownerName: session.username || String(session.userId ?? ''),
    bot: session.bot,
    message: message ?? session.event.message,
    quote: quote ?? session.quote,
  }
}

/**
 * 消息 → 待写入的 Clip。只做读取与转存，不碰数据库。
 */
export async function collectClip(
  ctx: Context,
  config: Config,
  source: CollectSource,
  visibility: Visibility,
): Promise<CollectedClip> {
  const message: any = source.message ?? {}
  const now = new Date()
  const baseTime = timeOf(message, new Date(message?.timestamp ?? now))
  const degraded: string[] = []
  const attachments: PendingAttachment[] = []
  const messages: PendingSnapshot[] = []

  const mainElements: Element[] = message.elements?.length ? message.elements : h.parse(message.content ?? '')
  const mainUser = userOf(message)
  if (!mainUser.username) mainUser.username = mainUser.nickname || mainUser.userId || ''
  if (!mainUser.avatar) mainUser.avatar = avatarOf(message?.user, mainUser.userId, source.platform)

  const messageId = String(message.id || message.messageId || makeMessageId(mainElements, baseTime))

  messages.push(await buildSnapshot(ctx, config, {
    role: 'main',
    elements: mainElements,
    messageId,
    timestamp: baseTime,
    quoteDepth: 0,
    ...mainUser,
  }, attachments, 0))

  // 合并转发：主消息里出现 <forward id> 就展开，并逐层递归到 forwardDepth。
  // NapCat 会把整个转发的 content 直接塞进 CQ 码/段数据里，能读到就不用再发一次 API。
  if (config.forwardDepth > 0) {
    const queue: { id: string; depth: number; inline?: any[] }[] = []
    for (const el of mainElements) {
      if (el.type !== 'forward' || !el.attrs.id) continue
      queue.push({ id: String(el.attrs.id), depth: 1, inline: forwardInline(el.attrs) })
    }
    const seen = new Set<string>()
    while (queue.length) {
      const current = queue.shift()!
      if (seen.has(current.id)) continue
      seen.add(current.id)

      const nodes = (current.inline?.length ? current.inline : null)
        ?? await expandForward(source.bot, current.id, config.forwardLimit)
      if (!nodes) {
        degraded.push('forward-unavailable')
        messages[0].degraded.push('forward-unavailable')
        continue
      }

      let truncated = false
      let count = 0
      for (const node of nodes) {
        if (count >= config.forwardLimit || messages.length >= MAX_FORWARD_MESSAGES) {
          truncated = true
          break
        }
        const elements = parseSegments(node?.message)
        if (!elements.length) continue
        count++
        const user = node?.sender ?? {}
        const nickname = String(user.card || user.nickname || '')
        const userId = String(user.user_id ?? node?.user_id ?? '')
        messages.push(await buildSnapshot(ctx, config, {
          role: 'forward',
          elements,
          depth: current.depth,
          messageId: String(node?.message_id ?? ''),
          timestamp: timeOf({ timestamp: node?.time ? node.time * 1000 : undefined }, baseTime),
          quoteDepth: 0,
          parentId: current.id,
          userId,
          username: nickname,
          nickname,
          avatar: avatarOf(node, userId, source.platform),
        }, attachments, messages.length))

        // 这一条自己又是一个合并转发：继续往下走一层
        if (current.depth < config.forwardDepth) {
          for (const el of elements) {
            if (el.type !== 'forward' || !el.attrs.id) continue
            queue.push({ id: String(el.attrs.id), depth: current.depth + 1, inline: forwardInline(el.attrs) })
          }
        }
      }
      if (truncated) {
        degraded.push('forward-truncated')
        messages[0].degraded.push('forward-truncated')
      }
    }
  }

  // 引用链：从被收藏消息自身的引用开始往上爬。
  // 注意必须先查重再入队：有些适配器会把「这条消息自己」放进 quote（或 quote 指回主消息），
  // 不查重就会把同一条消息存两遍，条数和附件都会翻倍。
  let quote: any = source.quote ?? message.quote
  let depth = 1
  const visited = new Set<string>([messageId])
  const queue: any[] = []
  while (quote && depth <= config.quoteDepth) {
    const currentId = String(quote.id ?? '')
    if (currentId && visited.has(currentId)) break
    if (currentId) visited.add(currentId)
    queue.push(quote)
    const next = quote.quote
    if (!next) break
    quote = next
    depth++
  }

  for (const [i, item] of queue.entries()) {
    const quoteId = String(item.id ?? '')
    if (quoteId) visited.add(quoteId)
    const elements: Element[] = item.elements?.length ? item.elements : h.parse(item.content ?? '')
    const user = userOf(item)
    const missing: string[] = []
    if (!user.userId) missing.push('quote-user-missing')
    if (!item.timestamp && !item.createdAt) missing.push('quote-time-missing')
    if (missing.length && !degraded.includes('quote-incomplete')) degraded.push('quote-incomplete')
    messages.push(await buildSnapshot(ctx, config, {
      role: 'quote',
      elements,
      messageId: quoteId || makeMessageId(elements, baseTime),
      timestamp: timeOf(item, baseTime),
      quoteDepth: i + 1,
      userId: user.userId,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar || avatarOf(item.user, user.userId, source.platform),
      degraded: missing,
    }, attachments, messages.length))
  }

  messages[0].degraded = [...new Set([...messages[0].degraded, ...degraded])]

  return {
    platform: source.platform,
    channelId: source.channelId,
    guildId: source.guildId,
    messageId,
    ownerId: source.ownerId,
    ownerName: source.ownerName,
    visibility,
    degraded: [...new Set([...degraded, ...messages.flatMap((item) => item.degraded ?? [])])],
    meta: {
      kind: source.guildId ? 'group' : 'private',
      guildName: source.guildName,
      channelName: source.channelName,
    },
    messages,
    attachments,
  }
}

export interface PersistResult {
  clip: Clip
  existing: boolean
  /** 之前软删除过、这次重新收藏把它从回收站拉了回来 */
  restored?: boolean
}

/**
 * 「条数」的口径：引用链、转发展开的每一条各算一条；
 * 主消息只有在**带文字**（或没有转发）时才算一条 —— 纯转发的空壳不计。
 */
export function countMessages(messages: { role: Role, content: string }[]): number {
  const hasForward = messages.some((message) => message.role === 'forward')
  return messages.filter((message) => !(message.role === 'main' && hasForward && !message.content.trim())).length
}

/** 幂等写入：唯一键命中就返回已有记录。 */
export async function persistClip(ctx: Context, data: CollectedClip): Promise<PersistResult> {
  const key = {
    platform: data.platform,
    channelId: data.channelId,
    messageId: data.messageId,
    ownerId: data.ownerId,
  }
  const existing = await ctx.database.get(TABLES.clip, key)
  if (existing.length) {
    const old = existing[0] as Clip
    if (!old.deletedAt) return { clip: old, existing: true }
    // 之前删掉的同一条消息：重新收藏时把它从回收站拉回来，而不是报「已经收藏过了」
    await ctx.database.set(TABLES.clip, { id: old.id }, {
      deletedAt: null,
      visibility: data.visibility,
      messageCount: countMessages(data.messages),
      ownerName: data.ownerName,
      degraded: data.degraded,
      meta: data.meta,
      createdAt: new Date(),
    })
    const [revived] = await ctx.database.get(TABLES.clip, { id: old.id })
    return { clip: revived as Clip, existing: false, restored: true }
  }

  let clipId: number
  try {
    const created = await ctx.database.create(TABLES.clip, {
      ...key,
      no: await nextClipNo(ctx),
      guildId: data.guildId,
      ownerName: data.ownerName,
      visibility: data.visibility,
      messageCount: countMessages(data.messages),
      createdAt: new Date(),
      degraded: data.degraded,
      meta: data.meta,
    })
    clipId = created.id
  } catch {
    const fallback = await ctx.database.get(TABLES.clip, key)
    if (fallback.length) return { clip: fallback[0] as Clip, existing: true }
    throw new Error('failed to create clip')
  }

  const rowIds: number[] = []
  for (const [index, snapshot] of data.messages.entries()) {
    const created = await ctx.database.create(TABLES.message, {
      clipId,
      seq: index,
      role: snapshot.role,
      quoteDepth: snapshot.quoteDepth,
      depth: snapshot.depth,
      parentId: snapshot.parentId,
      messageId: snapshot.messageId,
      userId: snapshot.userId,
      username: snapshot.username,
      nickname: snapshot.nickname,
      avatar: snapshot.avatar,
      content: snapshot.content,
      elements: snapshot.elements,
      timestamp: snapshot.timestamp,
      degraded: snapshot.degraded,
    })
    rowIds[index] = created.id
  }

  for (const row of data.attachments) {
    await ctx.database.create(TABLES.attachment, {
      clipId,
      messageRowId: rowIds[row.index] ?? rowIds[0],
      type: row.type,
      assetsUrl: row.assetsUrl,
      originalUrl: row.originalUrl,
      filename: row.filename,
      size: row.size,
      expired: row.expired,
      note: row.note,
    })
  }

  const [clip] = await ctx.database.get(TABLES.clip, { id: clipId })
  return { clip: clip as Clip, existing: false }
}

export async function loadClip(ctx: Context, id: number) {
  const [clip] = await ctx.database.get(TABLES.clip, { id })
  if (!clip) return null
  const messages = await ctx.database.get(TABLES.message, { clipId: id }, { sort: { seq: 'asc' } }) as Snapshot[]
  const attachments = await ctx.database.get(TABLES.attachment, { clipId: id }) as any[]
  return { clip: clip as Clip, messages, attachments }
}
