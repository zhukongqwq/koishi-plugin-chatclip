import { Clip, Snapshot, formatClipId } from '../db'
import { formatTime } from './html'

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

/** 列表摘要用：去掉 [图片]/[文件] 之类的占位，媒体数量另行统计。 */
export function summaryText(content: string, hasForward = false) {
  const clean = (content ?? '')
    .replace(/\[(图片|视频|语音|文件)\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean) return clean
  return hasForward ? '[合并转发]' : '[无文字内容]'
}

export function truncate(text: string, limit: number) {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > limit ? clean.slice(0, limit) + '…' : clean
}

function ordinal(index: number) {
  return CIRCLED[index] ?? `(${index + 1})`
}

function relativeTime(date: Date, now = new Date()) {
  const value = new Date(date)
  const startOfDay = (input: Date) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime()
  const diff = Math.round((startOfDay(now) - startOfDay(value)) / 86400000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(value.getHours())}:${pad(value.getMinutes())}`
  if (diff === 0) return `今天 ${clock}`
  if (diff === 1) return `昨天 ${clock}`
  return `${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${clock}`
}

function visibilityLabel(visibility: string) {
  return visibility === 'public' ? '公开' : visibility === 'channel' ? '本群可见' : '仅自己'
}

function splitMain(messages: Snapshot[]) {
  const main = messages.find((item) => item.role === 'main') ?? messages[0]
  const quote = messages.find((item) => item.role === 'quote')
  const forwards = messages.filter((item) => item.role === 'forward')
  return { main, quote, forwards }
}

function markLine(messages: Snapshot[]) {
  const { quote, forwards } = splitMain(messages)
  const marks: string[] = []
  if (quote) {
    const name = quote.nickname || quote.username || '未知'
    marks.push(`引用 ${name}：${truncate(quote.content, 14)}`)
  }
  if (forwards.length) marks.push(`转发 ${forwards.length} 条`)
  const media = messages.flatMap((item) => mediaTypes(item))
  const images = media.filter((type) => type === 'img' || type === 'image').length
  const files = media.filter((type) => type === 'file').length
  const audios = media.filter((type) => type === 'audio' || type === 'record').length
  if (images) marks.push(`图 ×${images}`)
  if (files) marks.push(`文件 ×${files}`)
  if (audios) marks.push(`语音 ×${audios}`)
  return marks.length ? `  ↳ ${marks.join(' · ')}` : ''
}

export function mediaTypes(snapshot: Snapshot): string[] {
  const result: string[] = []
  const walk = (elements: any[]) => {
    for (const el of elements ?? []) {
      if (!el || typeof el === 'string') continue
      if (el.type && el.attrs && ['img', 'image', 'video', 'audio', 'record', 'file'].includes(el.type)) result.push(el.type)
      if (Array.isArray(el.children)) walk(el.children)
    }
  }
  walk(snapshot.elements as any[])
  return result
}

export interface ListItem {
  clip: Clip
  messages: Snapshot[]
}

export function renderList(items: ListItem[], options: {
  title?: string
  page: number
  pageSize: number
  total: number
}) {
  const pages = Math.max(1, Math.ceil(options.total / options.pageSize))
  const header = `${options.title ?? '📚 我的收藏'} · 共 ${options.total} 条 · 第 ${options.page}/${pages} 页`
  if (!items.length) {
    return '📭 没有找到符合条件的收藏。\n试试 /clip list，或用 /clip search 关键词 换个条件。'
  }
  const lines: string[] = [header, '────────────────────────────']
  for (const item of items) {
    const { main, forwards } = splitMain(item.messages)
    const name = main?.nickname || main?.username || item.clip.ownerName || '未知'
    lines.push(`${formatClipId(item.clip.id)} · ${truncate(name, 12)} · ${relativeTime(main?.timestamp ?? item.clip.createdAt)} · ${visibilityLabel(item.clip.visibility)}`)
    lines.push(`  ${truncate(summaryText(main?.content, forwards.length > 0), 25)}`)
    const marks = markLine(item.messages)
    if (marks) lines.push(marks)
    lines.push('')
  }
  lines.push('────────────────────────────')
  lines.push(`/clip show ${formatClipId(items[0].clip.id)} 渲染单条 · /clip list ${options.page + 1} 下一页`)
  return lines.join('\n').trimEnd()
}

export function renderDetail(clip: Clip, messages: Snapshot[], attachmentCount: number) {
  const { main } = splitMain(messages)
  const name = main?.nickname || main?.username || clip.ownerName || '未知'
  const source = clip.meta?.channelName || clip.meta?.guildName || (clip.meta?.kind === 'private' ? '私聊' : `频道 ${clip.channelId}`)
  const lines: string[] = [
    `${formatClipId(clip.id)} · ${name} · ${formatTime(main?.timestamp || clip.createdAt)} · ${visibilityLabel(clip.visibility)}`,
    '────────────────────────────',
  ]

  for (const [index, snapshot] of messages.entries()) {
    const speaker = snapshot.nickname || snapshot.username || snapshot.userId || '未知'
    const time = formatTime(snapshot.timestamp).slice(11)
    const prefix = snapshot.role === 'forward' ? '　' : snapshot.role === 'quote' ? '↳ ' : ''
    lines.push(`${prefix}${ordinal(index)} ${speaker} · ${time}`)
    for (const line of (snapshot.content || '[无文字内容]').split('\n')) {
      lines.push(`  ${line}`)
    }
  }

  lines.push('────────────────────────────')
  lines.push(`可见性 ${visibilityLabel(clip.visibility)} · 附件 ${attachmentCount} · 来源 ${source}`)
  if (clip.degraded?.length) lines.push(`⚠️ 降级 ${clip.degraded.join(', ')}`)
  return lines.join('\n')
}
