import { Clip, ElementJSON, Snapshot } from '../db'
import { clipNo, formatClipId } from '../db'
import { Config, DEFAULT_FONT } from '../config'


export function escapeHtml(text: string) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function formatTime(date?: Date | string) {
  if (!date) return ''
  const value = new Date(date)
  if (isNaN(value.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`
}

const PALETTE = ['#5b7cfa', '#f0a04b', '#57b894', '#c56cd6', '#e2647a', '#4aa3c7']

function colorOf(seed: string) {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 9973
  return PALETTE[hash % PALETTE.length]
}

function initialOf(name: string) {
  return (name || '?').trim().slice(0, 1)
}

function avatarHtml(snapshot: Snapshot, size: number) {
  const name = snapshot.nickname || snapshot.username || snapshot.userId || '?'
  const bg = colorOf(snapshot.userId || name)
  const style = `width:${size}px;height:${size}px;border-radius:50%;`
  if (snapshot.avatar) {
    // 头像拉不下来时退化成同色圆，不留破图图标
    return `<img class="avatar" alt="" style="${style}background:${bg}" src="${escapeHtml(snapshot.avatar)}"/>`
  }
  return `<div class="avatar" style="${style}background:${bg};font-size:${Math.round(size * 0.44)}px">${escapeHtml(initialOf(name))}</div>`
}

const MEDIA_TYPES = new Set(['img', 'image', 'video', 'audio', 'record', 'file'])

interface Split {
  text: string
  media: ElementJSON[]
  quoted: ElementJSON | null
  forwards: string[]
}

function splitElements(elements: ElementJSON[]): Split {
  const split: Split = { text: '', media: [], quoted: null, forwards: [] }
  const walk = (list: ElementJSON[]) => {
    for (const el of list) {
      if (el.type === 'text') {
        split.text += el.attrs.content ?? ''
      } else if (el.type === 'at') {
        split.text += `@${el.attrs.name || el.attrs.id || ''} `
      } else if (MEDIA_TYPES.has(el.type)) {
        split.media.push(el)
      } else if (el.type === 'quote') {
        split.quoted = el
      } else if (el.type === 'forward') {
        split.forwards.push(String(el.attrs.id ?? ''))
      } else if (el.type === 'face') {
        split.text += el.attrs.name || '🙂'
      } else if (Array.isArray(el.children) && el.children.length) {
        walk(el.children.filter((child): child is ElementJSON => typeof child !== 'string'))
      }
    }
  }
  walk(elements)
  split.text = split.text.replace(/\n{3,}/g, '\n\n').trim()
  return split
}

function textHtml(text: string) {
  return escapeHtml(text).replace(/\n/g, '<br/>')
}

function mediaHtml(media: ElementJSON[], maxHeight: number) {
  if (!media.length) return ''
  const items = media.map((el) => {
    const src = el.attrs.src || el.attrs.url || ''
    if (!src) return ''
    if (el.type === 'video') {
      return `<video class="media-item" style="max-height:${maxHeight}px" src="${escapeHtml(src)}"></video>`
    }
    if (el.type === 'file') {
      const title = el.attrs.title || el.attrs.name || '文件'
      return `<div class="file-chip">📎 ${escapeHtml(title)}</div>`
    }
    if (el.type === 'audio' || el.type === 'record') {
      return `<div class="file-chip">🎙 语音</div>`
    }
    return `<img class="media-item" style="max-height:${maxHeight}px" src="${escapeHtml(src)}"/>`
  }).filter(Boolean)

  if (!items.length) return ''
  const count = items.length
  if (count === 1) return `<div class="media media-1">${items[0]}</div>`
  // 9 宫格：三列正方形，超过 9 张时补一个 +N 格子
  const limit = 9
  const more = count > limit ? `<div class="more">+${count - limit}</div>` : ''
  return `<div class="media media-grid">${items.slice(0, limit).join('')}${more}</div>`
}

function quoteBlock(quote: Snapshot | undefined, compact: boolean) {
  if (!quote) return ''
  const split = splitElements(quote.elements)
  const name = quote.nickname || quote.username || quote.userId || '未知'
  const text = split.text.length > 90 ? split.text.slice(0, 90) + '…' : split.text
  const thumb = split.media.find((el) => (el.type === 'img' || el.type === 'image') && (el.attrs.src || el.attrs.url))
  const thumbHtml = thumb
    ? `<img class="quote-thumb" src="${escapeHtml(thumb.attrs.src || thumb.attrs.url)}"/>`
    : ''
  return `<div class="quote ${compact ? 'quote-compact' : ''}">
    <div class="quote-body">
      <div class="quote-head">${escapeHtml(name)} · ${formatTime(quote.timestamp)}</div>
      <div class="quote-text">${textHtml(text) || '<span class="dim">[无文字内容]</span>'}</div>
    </div>
    ${thumbHtml}
  </div>`
}

/** 转发内容按聊天气泡逐条排，嵌套转发再开一层缩进。 */
function forwardRows(
  children: Snapshot[],
  byParent: Map<string, Snapshot[]>,
  depth: number,
): string {
  return children.map((child) => {
    const split = splitElements(child.elements)
    const name = child.nickname || child.username || child.userId || '未知'
    const nested = split.forwards
      .map((id) => {
        const list = byParent.get(id) ?? []
        if (!list.length) {
          // 老数据（展开深度为 1 时收藏的）只有 forward id，没有子消息
          return `<div class="fwd-sub"><div class="fwd-sub-head dim">更深的聊天记录没有展开</div></div>`
        }
        return `<div class="fwd-sub">
          <div class="fwd-sub-head">聊天记录 · ${list.length} 条</div>
          ${forwardRows(list, byParent, depth + 1)}
        </div>`
      })
      .join('')
    const inner = split.text ? textHtml(split.text) : ''
    const empty = !split.text && !split.media.length && !nested
    const body = `${inner}${mediaHtml(split.media, 150)}${nested}${empty ? '<span class="dim">[无文字内容]</span>' : ''}`
    return `<div class="fwd-row" style="margin-left:${(depth - 1) * 8}px">
      ${avatarHtml(child, 22)}
      <div class="fwd-main">
        <div class="fwd-name">${escapeHtml(name)}<span class="fwd-time">${formatTime(child.timestamp)}</span></div>
        <div class="fwd-bubble${depth > 1 ? ' deep' : ''}">${body}</div>
      </div>
    </div>`
  }).join('')
}

function forwardBlock(children: Snapshot[], byParent: Map<string, Snapshot[]>) {
  if (!children.length) return ''
  return `<div class="fwd">
    <div class="fwd-head">群聊的聊天记录<span class="dim"> · ${children.length} 条</span></div>
    ${forwardRows(children, byParent, 1)}
  </div>`
}

const baseStyle = (font: string) => `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #eef1f6; font-family: ${font}; -webkit-font-smoothing: antialiased; }
.card { background: #fff; border-radius: 24px; padding: 32px 36px; color: #1f2430; box-shadow: 0 8px 28px rgba(31, 36, 48, .08); }
.avatar { display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; object-fit: cover; flex: none; }
.dim { color: #98a2b3; }
.media { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-start; margin-top: 16px; }
.media-1 { display: block; }
.media-item { max-width: 100%; border-radius: 14px; border: 1px solid #e7ebf3; display: block; }
.media-1 .media-item, .media-1 video { max-width: 66%; aspect-ratio: 1 / 1; object-fit: cover; height: auto; }
.media-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.media-grid .media-item, .media-grid video {
  width: 100%; aspect-ratio: 1 / 1; height: auto; object-fit: cover;
}
.media-grid .file-chip { width: 100%; aspect-ratio: 1 / 1; height: auto; flex-direction: column; justify-content: center; text-align: center; }
.more {
  display: flex; align-items: center; justify-content: center;
  width: 100%; aspect-ratio: 1 / 1; border-radius: 14px;
  background: #f1f4fa; color: #98a2b3; font-size: 22px; font-weight: 600;
}
.file-chip { display: inline-flex; align-items: center; gap: 6px; background: #f5f7fb; border: 1px solid #e7ebf3; border-radius: 10px; padding: 8px 12px; font-size: 16px; color: #475467; }
.quote { display: flex; gap: 12px; align-items: flex-start; background: #f7f9fc; border-left: 4px solid #5b7cfa; border-radius: 12px; padding: 14px 16px; margin-top: 18px; }
.quote-body { flex: 1; min-width: 0; }
.quote-head { font-size: 15px; color: #667085; margin-bottom: 6px; }
.quote-text { font-size: 17px; color: #475467; line-height: 1.5; }
.quote-thumb { width: 108px; height: 108px; object-fit: cover; border-radius: 10px; border: 1px solid #e7ebf3; flex: none; }
.fwd { padding: 0; }
.fwd-head { font-size: 16px; font-weight: 600; color: #667085; margin-bottom: 8px; }
.fwd-row { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; }
.fwd-row + .fwd-row { border-top: 1px dashed #f0f3f9; }
.fwd-main { flex: 1; min-width: 0; }
.fwd-name { font-size: 15px; font-weight: 600; color: #475467; margin-bottom: 5px; }
.fwd-time { font-weight: 400; font-size: 13px; color: #98a2b3; margin-left: 6px; }
.fwd-bubble { background: #f7f9fc; border-radius: 12px; padding: 10px 14px; font-size: 16px; line-height: 1.55; word-break: break-word; }
.fwd-bubble.deep { background: #fbfcfe; border: 1px solid #f0f3f9; }
.fwd-sub { margin-top: 8px; border-left: 3px solid #e2e8f5; border-radius: 8px; padding: 6px 8px; }
.fwd-sub-head { font-size: 14px; color: #667085; margin-bottom: 6px; }
.foot { display: flex; justify-content: space-between; align-items: center; margin-top: 24px; padding-top: 14px; border-top: 1px solid #eef1f6; font-size: 14px; color: #98a2b3; }
`

function page(style: string, body: string, width: number, font = DEFAULT_FONT) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseStyle(font)}${style}</style></head><body><div class="card" style="width:${width}px">${body}</div></body></html>`
}

/** 单条消息：大字卡。 */
export function buildCard(clip: Clip, main: Snapshot, quote: Snapshot | undefined, config: Config) {
  const split = splitElements(main.elements)
  const name = main.nickname || main.username || main.userId || '未知'
  const length = split.text.length
  const fontSize = length <= 30 ? 32 : length <= 80 ? 27 : 22
  const body = `
  <div class="top">
    ${avatarHtml(main, 48)}
    <div class="main">
      <div class="mark">“</div>
      <div class="text" style="font-size:${fontSize}px">${textHtml(split.text) || '<span class="dim">[无文字内容]</span>'}</div>
      ${split.text ? '<div class="mark close">”</div>' : ''}
      <div class="sign">—— ${escapeHtml(name)}（${escapeHtml(main.username || name)}）</div>
      <div class="uid">(userId: ${escapeHtml(main.userId || '未知')})</div>
    </div>
  </div>
  ${quoteBlock(quote, false)}
  ${mediaHtml(split.media, 200)}
  <div class="foot"><span>chatclip · ${formatClipId(clipNo(clip))}</span><span>${formatTime(main.timestamp)}</span></div>`
  const style = `
.top { display: flex; gap: 18px; align-items: flex-start; }
.main { flex: 1; min-width: 0; }
.mark { font-size: 40px; line-height: 1; color: #dfe4ee; font-family: Georgia, serif; }
.mark.close { font-size: 34px; margin-top: 2px; text-align: right; }
.text { font-weight: 700; line-height: 1.42; letter-spacing: .2px; margin-top: 4px; word-break: break-word; }
.sign { margin-top: 18px; font-size: 21px; color: #344054; }
.uid { margin-top: 6px; font-size: 16px; color: #98a2b3; }
`
  return page(style, body, config.imageWidth, config.fontFamily)
}

/** 多条消息：聊天气泡。 */
export function buildBubble(clip: Clip, messages: Snapshot[], config: Config) {
  const main = messages[0]
  const quote = messages.find((item) => item.role === 'quote')
  const forwards = messages.filter((item) => item.role === 'forward')
  const source = clip.meta?.channelName || clip.meta?.guildName || (clip.meta?.kind === 'private' ? '私聊' : `频道 ${clip.channelId}`)

  const rows: string[] = []
  const mainSplit = splitElements(main.elements)
  // 纯合并转发的消息没有正文，直接展示转发卡片，避免出现空气泡
  const skipMain = !mainSplit.text && !mainSplit.media.length && forwards.length > 0
  if (!skipMain) {
    rows.push(rowHtml(main, quote, mainSplit))
  } else {
    rows.push(`<div class="row">
      <div class="col">
        <div class="name">${escapeHtml(main.nickname || main.username || main.userId || '未知')}<span class="time">${formatTime(main.timestamp)}</span></div>
        <div class="bubblebody fwd-note">转发了一条聊天记录</div>
      </div>
    </div>`)
  }

  if (forwards.length) {
    const byParent = new Map<string, Snapshot[]>()
    for (const item of forwards) {
      const key = item.parentId ?? ''
      const list = byParent.get(key) ?? []
      list.push(item)
      byParent.set(key, list)
    }
    const top = forwards.filter((item) => (item.depth ?? 1) <= 1)
    rows.push(`<div class="row"><div class="col">${forwardBlock(top.length ? top : forwards, byParent)}</div></div>`)
  }

  const body = `
  <div class="bhead">
    <div><div class="btitle">聊天记录收藏</div><div class="bmeta">${escapeHtml(source)} · ${formatTime(clip.createdAt)} · 共 ${clip.messageCount} 条</div></div>
    <div class="pill">${escapeHtml(visibilityLabel(clip.visibility))}</div>
  </div>
  <div class="rows">${rows.join('')}</div>
  <div class="foot"><span>chatclip · ${formatClipId(clipNo(clip))}</span><span>${formatTime(clip.createdAt)}</span></div>`
  const style = `
.bhead { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 18px; border-bottom: 1px solid #eef1f6; }
.btitle { font-size: 24px; font-weight: 700; }
.bmeta { font-size: 15px; color: #98a2b3; margin-top: 6px; }
.pill { font-size: 15px; color: #5b7cfa; background: #eef2ff; border-radius: 999px; padding: 8px 16px; flex: none; margin-left: 16px; }
.rows { padding-top: 8px; }
.row { display: flex; gap: 14px; padding: 18px 0; }
.row + .row { border-top: 1px solid #f4f6fa; }
.row .avatar { width: 30px; height: 30px; }
.col { flex: 1; min-width: 0; }
.name { font-size: 17px; font-weight: 600; margin-bottom: 8px; }
.name .time { font-weight: 400; font-size: 14px; color: #98a2b3; margin-left: 8px; }
.bubblebody { background: #f7f9fc; border-radius: 14px; padding: 14px 16px; font-size: 18px; line-height: 1.55; word-break: break-word; }
.ghost { background: transparent !important; }
.fwd-note { display: inline-block; max-width: 210px; padding: 12px 16px; color: #667085; white-space: nowrap; }
`
  return page(style, body, config.imageWidth, config.fontFamily)
}

function visibilityLabel(visibility: string) {
  return visibility === 'public' ? '公开' : visibility === 'channel' ? '本群可见' : '仅自己可见'
}

function rowHtml(snapshot: Snapshot, quote: Snapshot | undefined, split: Split) {
  const name = snapshot.nickname || snapshot.username || snapshot.userId || '未知'
  return `<div class="row">
    ${avatarHtml(snapshot, 30)}
    <div class="col">
      <div class="name">${escapeHtml(name)}<span class="time">${formatTime(snapshot.timestamp)}</span></div>
      <div class="bubblebody">${textHtml(split.text) || '<span class="dim">[无文字内容]</span>'}${quoteBlock(quote, true)}${mediaHtml(split.media, 220)}</div>
    </div>
  </div>`
}
