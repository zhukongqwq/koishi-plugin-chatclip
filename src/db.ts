import { Context } from 'koishi'

export type Visibility = 'private' | 'channel' | 'public'
export type Role = 'main' | 'quote' | 'forward'

/** 元素序列化后的形态，数据库里只存它，渲染时再还原成 h 元素。 */
export interface ElementJSON {
  type: string
  attrs: Record<string, any>
  children: (ElementJSON | string)[]
}

export interface ClipMeta {
  guildName?: string
  channelName?: string
  /** group = 群聊，private = 私聊 */
  kind?: 'group' | 'private'
}

export interface Clip {
  id: number
  platform: string
  channelId: string
  guildId?: string
  messageId: string
  ownerId: string
  ownerName: string
  visibility: Visibility
  messageCount: number
  createdAt: Date
  deletedAt?: Date
  degraded: string[]
  meta: ClipMeta
}

export interface Snapshot {
  id: number
  clipId: number
  seq: number
  role: Role
  quoteDepth: number
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

export interface Attachment {
  id: number
  clipId: number
  messageRowId: number
  type: string
  assetsUrl?: string
  originalUrl: string
  filename?: string
  size?: number
  expired: boolean
}

declare module 'koishi' {
  interface Tables {
    'chatclip_clip': Clip
    'chatclip_message': Snapshot
    'chatclip_attachment': Attachment
  }
}

export const TABLES = {
  clip: 'chatclip_clip',
  message: 'chatclip_message',
  attachment: 'chatclip_attachment',
} as const

/**
 * 三张表一次建好。minato 不会补建 unique，也不会给已存在的表加索引，
 * 所以字段和索引必须一次性声明完整（见 docs/adr/0004）。
 */
export function applyTables(ctx: Context) {
  ctx.model.extend(TABLES.clip, {
    id: 'unsigned',
    platform: 'string',
    channelId: 'string',
    guildId: 'string',
    messageId: 'string',
    ownerId: 'string',
    ownerName: 'string',
    visibility: 'string',
    messageCount: 'unsigned',
    createdAt: 'timestamp',
    deletedAt: 'timestamp',
    degraded: 'json',
    meta: 'json',
  }, {
    autoInc: true,
    primary: 'id',
    unique: [['platform', 'channelId', 'messageId', 'ownerId']],
    indexes: [
      ['ownerId', 'createdAt'],
      ['channelId', 'createdAt'],
      ['visibility', 'createdAt'],
    ],
  })

  ctx.model.extend(TABLES.message, {
    id: 'unsigned',
    clipId: 'unsigned',
    seq: 'unsigned',
    role: 'string',
    quoteDepth: 'unsigned',
    parentId: 'string',
    messageId: 'string',
    userId: 'string',
    username: 'string',
    nickname: 'string',
    avatar: 'string',
    content: 'text',
    elements: 'json',
    timestamp: 'timestamp',
    degraded: 'json',
  }, {
    autoInc: true,
    primary: 'id',
    indexes: [
      ['clipId', 'seq'],
      ['messageId'],
    ],
  })

  ctx.model.extend(TABLES.attachment, {
    id: 'unsigned',
    clipId: 'unsigned',
    messageRowId: 'unsigned',
    type: 'string',
    assetsUrl: 'text',
    originalUrl: 'text',
    filename: 'string',
    size: 'unsigned',
    expired: 'boolean',
  }, {
    autoInc: true,
    primary: 'id',
    indexes: [['clipId']],
  })
}

export interface ClipQuery {
  ownerId?: string
  channelId?: string
  channelIds?: string[]
  visibility?: Visibility[]
  keyword?: string
  from?: string[]
  start?: Date
  end?: Date
  includeDeleted?: boolean
  /** 只看已软删除的（控制台「回收站」） */
  deletedOnly?: boolean
}

/**
 * 关键词 / 发送者都落在 chatclip_message 上，所以先算出允许的 clipId 集合，
 * 再回到 clip 表分页。返回 null 表示"不限制"。
 */
export async function resolveClipIds(ctx: Context, query: ClipQuery): Promise<number[] | null> {
  const { keyword, from } = query
  if (!keyword && !from?.length) return null

  const filter: any = {}
  if (keyword) filter.content = { $regex: escapeRegex(keyword) }
  const rows = await ctx.database.get(TABLES.message, filter, {
    fields: ['clipId', 'username', 'nickname', 'userId'],
  })

  const hit = new Set<number>()
  for (const row of rows) {
    if (from?.length) {
      const names = [row.username, row.nickname, row.userId].filter(Boolean)
      if (!names.some((name) => from.includes(name))) continue
    }
    hit.add(row.clipId)
  }
  return [...hit]
}

export function buildClipQuery(query: ClipQuery, clipIds: number[] | null): any {
  const filter: any = {}
  if (query.ownerId) filter.ownerId = query.ownerId
  if (query.channelId) filter.channelId = query.channelId
  else if (query.channelIds?.length) filter.channelId = { $in: query.channelIds }
  if (query.visibility?.length) filter.visibility = { $in: query.visibility }
  if (clipIds) filter.id = { $in: clipIds }
  if (!query.includeDeleted && !query.deletedOnly) filter.deletedAt = null
  if (query.start || query.end) {
    filter.createdAt = {}
    if (query.start) filter.createdAt.$gte = query.start
    if (query.end) filter.createdAt.$lte = query.end
  }
  return filter
}

export interface ClipPage {
  items: Clip[]
  total: number
}

export async function queryClips(
  ctx: Context,
  query: ClipQuery,
  page = 1,
  pageSize = 10,
): Promise<ClipPage> {
  const clipIds = await resolveClipIds(ctx, query)
  if (clipIds && !clipIds.length) return { items: [], total: 0 }
  const filter = buildClipQuery(query, clipIds)

  // minato 的 `$ne: null` 在 SQL 里是 `!= NULL`，永远不成立，所以回收站用 id 集合过滤
  if (query.deletedOnly) {
    const all = await ctx.database.get(TABLES.clip, {}, { fields: ['id', 'deletedAt'] })
    const deleted = all.filter((row) => row.deletedAt).map((row) => row.id)
    const narrowed = Array.isArray(filter.id?.$in)
      ? (filter.id.$in as number[]).filter((id) => deleted.includes(id))
      : deleted
    if (!narrowed.length) return { items: [], total: 0 }
    filter.id = { $in: narrowed }
  }

  const ids = await ctx.database.get(TABLES.clip, filter, {
    fields: ['id'],
    sort: { createdAt: 'desc' },
    limit: 20000,
  })
  const total = ids.length
  if (!total) return { items: [], total: 0 }

  const offset = Math.max(0, (page - 1) * pageSize)
  const pageIds = ids.slice(offset, offset + pageSize).map((row) => row.id)
  if (!pageIds.length) return { items: [], total }

  const rows = await ctx.database.get(TABLES.clip, { id: { $in: pageIds } }, {
    sort: { createdAt: 'desc' },
  })
  return { items: rows as Clip[], total }
}

export function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface PurgeResult {
  /** 真正被硬删除的收藏 id */
  ids: number[]
  /** 因为还没软删除而被跳过的 id */
  skipped: number[]
}

/**
 * 硬删除：只允许已经软删除的收藏，连消息行与附件行一起删掉。
 * 传 all = true 时清空整个回收站。
 */
export async function purgeClips(
  ctx: Context,
  options: { ids?: number[], all?: boolean } = {},
): Promise<PurgeResult> {
  const rows = await ctx.database.get(TABLES.clip, {}, { fields: ['id', 'deletedAt'] })
  const deleted = rows.filter((row) => row.deletedAt).map((row) => row.id)
  const wanted = options.all ? deleted : (options.ids ?? []).filter((id) => deleted.includes(id))
  const skipped = options.all ? [] : (options.ids ?? []).filter((id) => !deleted.includes(id))
  if (!wanted.length) return { ids: [], skipped }

  await ctx.database.remove(TABLES.message, { clipId: { $in: wanted } })
  await ctx.database.remove(TABLES.attachment, { clipId: { $in: wanted } })
  await ctx.database.remove(TABLES.clip, { id: { $in: wanted } })
  return { ids: wanted, skipped }
}

/** `#A1031` / `A1031` / `a1031` / `1031` → 1031 */
export function parseClipId(input: string): number | null {
  if (!input) return null
  const match = input.trim().match(/^#?[aA]?(\d{1,9})$/)
  if (!match) return null
  return Number(match[1])
}

export function formatClipId(id: number) {
  return `#A${String(id).padStart(4, '0')}`
}
