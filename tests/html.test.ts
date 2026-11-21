/**
 * HTML 结构缝：不截图，只断言卡片/气泡里该出现的东西出现了。
 * 像素效果交给 scripts/smoke.ts 与人工看，这里守的是结构契约。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHtml } from '../src/render'
import { makeClip, makeConfig, makeSnapshot } from './helpers'
import type { Snapshot } from '../src/db'

const config = makeConfig()

function img() {
  return { type: 'img', attrs: { src: 'https://example.com/a.png' } }
}

function cardHtml(messages: Snapshot[], clip = makeClip({ id: 1 })) {
  return buildHtml(clip, messages, config, 'card')
}

function bubbleHtml(messages: Snapshot[], clip = makeClip({ id: 1 })) {
  return buildHtml(clip, messages, config, 'bubble')
}

test('单条卡片带成对引号，后引号在正文之后', () => {
  const html = cardHtml([makeSnapshot({ content: '升级成功！' })])
  const open = html.indexOf('<div class="mark">“</div>')
  const text = html.indexOf('升级成功！')
  const close = html.indexOf('<div class="mark close">”</div>')

  assert.ok(open >= 0, '缺少前引号')
  assert.ok(close >= 0, '缺少后引号')
  assert.ok(open < text && text < close, '引号顺序应为 前引号 → 正文 → 后引号')
  assert.ok(html.includes('—— 白露（bailu）'), '署名格式不对')
  assert.ok(html.includes('chatclip · #A0001'), '页脚编号缺失')
})

test('没有正文时不渲染后引号', () => {
  const html = cardHtml([makeSnapshot({ content: '', elements: [img()] })])
  assert.ok(html.includes('<div class="mark">“</div>'))
  assert.ok(!html.includes('mark close'))
  assert.ok(html.includes('<span class="dim">[无文字内容]</span>'))
})

test('卡片把引用单独成块展示', () => {
  const html = cardHtml([
    makeSnapshot({ content: '这个渲染函数我改完了' }),
    makeSnapshot({ seq: 1, role: 'quote', content: '气泡宽度要跟着内容走' }),
  ])
  assert.ok(html.includes('<div class="quote'))
  assert.ok(html.includes('气泡宽度要跟着内容走'))
})

test('纯合并转发的主消息不留空气泡，也不出现 [无文字内容]', () => {
  const forwards: Snapshot[] = [
    makeSnapshot({ seq: 1, role: 'forward', depth: 1, parentId: 'msg-main', content: '记得先 yarn build' }),
    makeSnapshot({ seq: 2, role: 'forward', depth: 1, parentId: 'msg-main', content: '收到' }),
  ]
  const html = bubbleHtml([
    makeSnapshot({ messageId: 'msg-main', content: '', elements: [{ type: 'forward', attrs: { id: 'fwd-1' } }] }),
    ...forwards,
  ], makeClip({ id: 3, messageCount: 3 }))

  assert.ok(html.includes('转发了一条聊天记录'))
  assert.ok(!html.includes('[无文字内容]'))
  assert.ok(html.includes('群聊的聊天记录'))
  assert.ok(html.includes(' · 2 条'))
})

test('九宫格最多 9 格，超出用 +N 收尾', () => {
  const elements = Array.from({ length: 11 }, () => img())
  const html = cardHtml([makeSnapshot({ content: '十一张图', elements })])

  assert.equal(html.split('class="media-item"').length - 1, 9)
  assert.ok(html.includes('class="more"'))
  assert.ok(html.includes('+2'))
})

test('转发按层嵌套：第二层出现 fwd-sub 且缩进 8px', () => {
  // 契约：子消息的 parentId 存的是「被展开的那段转发 id」，
  // 而父消息的 elements 里带着同一个 id 的 <forward>，嵌套就靠这个 id 对上。
  const html = bubbleHtml([
    makeSnapshot({ messageId: 'msg-main', content: '', elements: [{ type: 'forward', attrs: { id: 'fwd-outer' } }] }),
    makeSnapshot({
      seq: 1,
      role: 'forward',
      depth: 1,
      parentId: 'fwd-outer',
      messageId: 'o-1',
      content: '外层',
      elements: [
        { type: 'text', attrs: { content: '外层' } },
        { type: 'forward', attrs: { id: 'fwd-inner' } },
      ],
    }),
    makeSnapshot({ seq: 2, role: 'forward', depth: 2, parentId: 'fwd-inner', messageId: 'o-2', content: '内层' }),
  ], makeClip({ id: 4, messageCount: 3 }))

  assert.ok(html.includes('class="fwd-sub"'))
  assert.ok(html.includes('margin-left:8px'))
  assert.ok(html.includes('class="fwd-bubble deep"'))
  assert.ok(html.includes('内层'))
})

test('有头像时用 img，没有头像时退化成首字母', () => {
  const withAvatar = cardHtml([makeSnapshot({ content: '有头像', avatar: 'https://example.com/a.png' })])
  assert.ok(withAvatar.includes('<img class="avatar"'))
  assert.ok(withAvatar.includes('alt=""'))

  const withoutAvatar = cardHtml([makeSnapshot({ content: '没头像', avatar: '' })])
  assert.ok(!withoutAvatar.includes('<img class="avatar"'))
  assert.ok(withoutAvatar.includes('>白</div>'))
})
