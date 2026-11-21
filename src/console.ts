import { Context } from 'koishi'
import { Config } from './config'
import { Clip, Snapshot, TABLES, clipNo, formatClipId, parseClipId, purgeClips, queryClips } from './db'
import { loadClip } from './collect'
import { buildHtml } from './render'
import { summaryText, truncate, mediaTypes } from './render/text'

export interface ConsoleQuery {
  keyword?: string
  from?: string
  start?: string
  end?: string
  visibility?: string
  channelId?: string
  ownerId?: string
  /** all = 正常 + 回收站，none = 只看正常（默认），only = 只看回收站 */
  deleted?: 'all' | 'none' | 'only'
  page?: number
  pageSize?: number
}

export interface ClipRow {
  id: number
  key: string
  sender: string
  preview: string
  messageCount: number
  visibility: string
  source: string
  channelId: string
  createdAt: number
  deleted: boolean
}

declare module '@koishijs/console' {
  interface Events {
    'chatclip/list'(query: ConsoleQuery): Promise<{ items: ClipRow[], total: number }>
    'chatclip/get'(id: number): Promise<any>
    'chatclip/remove'(id: number): Promise<boolean>
    'chatclip/removeMany'(ids: number[]): Promise<{ ids: number[] }>
    'chatclip/restore'(id: number): Promise<boolean>
    'chatclip/restoreMany'(ids: number[]): Promise<{ ids: number[] }>
    'chatclip/purge'(payload: { ids?: number[], all?: boolean }): Promise<{ ids: number[], skipped: number[] }>
    'chatclip/visibility'(payload: { id: number, visibility: string }): Promise<boolean>
    'chatclip/export'(payload: { id: number, format: 'json' | 'html' }): Promise<string>
  }
}

function toRow(clip: Clip, messages: Snapshot[]): ClipRow {
  const main = messages.find((item) => item.role === 'main') ?? messages[0]
  const hasForward = messages.some((item) => item.role === 'forward')
  const media = main ? mediaTypes(main) : []
  const images = media.filter((type) => type === 'img' || type === 'image').length
  const files = media.filter((type) => type === 'file').length
  const audios = media.filter((type) => type === 'audio' || type === 'record').length
  const marks = [
    images ? `图 ×${images}` : '',
    files ? `文件 ×${files}` : '',
    audios ? `语音 ×${audios}` : '',
    hasForward ? `转发 ${messages.filter((item) => item.role === 'forward').length} 条` : '',
  ].filter(Boolean)
  const summary = truncate(summaryText(main?.content ?? '', hasForward), 40)
  const meta = (clip.meta ?? {}) as any
  return {
    id: clip.id,
    key: formatClipId(clipNo(clip)),
    sender: main?.nickname || main?.username || clip.ownerName || '未知',
    preview: marks.length ? `${summary} · ${marks.join(' · ')}` : summary,
    messageCount: clip.messageCount,
    visibility: clip.visibility,
    source: meta.channelName || meta.guildName || (meta.kind === 'private' ? '私聊' : clip.channelId),
    channelId: clip.channelId,
    createdAt: new Date(clip.createdAt).getTime(),
    deleted: !!clip.deletedAt,
  }
}

export function applyConsole(ctx: Context, config: Config) {
  ctx.console.addListener('chatclip/list', async (query = {}) => {
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
    const visibility = query.visibility && query.visibility !== 'all'
      ? [query.visibility as any]
      : undefined

    const result = await queryClips(ctx, {
      keyword: query.keyword || undefined,
      from: query.from ? [query.from] : undefined,
      start: query.start ? new Date(query.start) : undefined,
      end: query.end ? new Date(query.end) : undefined,
      visibility,
      channelId: query.channelId || undefined,
      ownerId: query.ownerId || undefined,
      includeDeleted: query.deleted !== 'none',
      deletedOnly: query.deleted === 'only',
    }, page, pageSize)

    const clips = result.items as Clip[]
    if (!clips.length) return { items: [], total: result.total }
    const messages = await ctx.database.get(TABLES.message, {
      clipId: { $in: clips.map((clip) => clip.id) },
    }, { sort: { seq: 'asc' } }) as Snapshot[]
    const map = new Map<number, Snapshot[]>()
    for (const row of messages) {
      const list = map.get(row.clipId) ?? []
      list.push(row)
      map.set(row.clipId, list)
    }
    return {
      items: clips.map((clip) => toRow(clip, map.get(clip.id) ?? [])),
      total: result.total,
    }
  })

  ctx.console.addListener('chatclip/get', async (id) => {
    const clipId = typeof id === 'number' ? id : parseClipId(String(id))
    if (!clipId) return null
    const loaded = await loadClip(ctx, clipId)
    if (!loaded) return null
    const attachments = loaded.attachments.map((row: any) => ({
      id: row.id,
      type: row.type,
      url: row.assetsUrl || row.originalUrl,
      originalUrl: row.originalUrl,
      filename: row.filename,
      expired: !!row.expired,
    }))
    return {
      clip: { ...loaded.clip, key: formatClipId(clipNo(loaded.clip)) },
      messages: loaded.messages,
      attachments,
    }
  })

  ctx.console.addListener('chatclip/remove', async (id) => {
    const clipId = typeof id === 'number' ? id : parseClipId(String(id))
    if (!clipId) return false
    await ctx.database.set(TABLES.clip, clipId, { deletedAt: new Date() })
    return true
  })

  ctx.console.addListener('chatclip/restore', async (id) => {
    const clipId = typeof id === 'number' ? id : parseClipId(String(id))
    if (!clipId) return false
    await ctx.database.set(TABLES.clip, clipId, { deletedAt: null })
    return true
  })

  // 批量软删除 / 批量恢复：控制台的多选操作
  ctx.console.addListener('chatclip/removeMany', async (ids) => {
    const clean = (ids ?? []).map((id) => Number(id)).filter((id) => id > 0)
    if (!clean.length) return { ids: [] }
    await ctx.database.set(TABLES.clip, { id: { $in: clean } }, { deletedAt: new Date() })
    return { ids: clean }
  })

  ctx.console.addListener('chatclip/restoreMany', async (ids) => {
    const clean = (ids ?? []).map((id) => Number(id)).filter((id) => id > 0)
    if (!clean.length) return { ids: [] }
    await ctx.database.set(TABLES.clip, { id: { $in: clean } }, { deletedAt: null })
    return { ids: clean }
  })

  // 硬删除：只有已经软删除的收藏才会被真正删掉，其余回在 skipped 里
  ctx.console.addListener('chatclip/purge', async (payload = {}) => {
    return purgeClips(ctx, { ids: payload.ids, all: payload.all })
  })

  ctx.console.addListener('chatclip/visibility', async ({ id, visibility }) => {
    const clipId = typeof id === 'number' ? id : parseClipId(String(id))
    if (!clipId || !['private', 'channel', 'public'].includes(visibility)) return false
    await ctx.database.set(TABLES.clip, clipId, { visibility: visibility as any })
    return true
  })

  ctx.console.addListener('chatclip/export', async ({ id, format }) => {
    const clipId = typeof id === 'number' ? id : parseClipId(String(id))
    if (!clipId) return ''
    const loaded = await loadClip(ctx, clipId)
    if (!loaded) return ''
    if (format === 'html') return buildHtml(loaded.clip, loaded.messages, config)
    return JSON.stringify({
      ...loaded.clip,
      messages: loaded.messages,
      attachments: loaded.attachments,
    }, null, 2)
  })
}
