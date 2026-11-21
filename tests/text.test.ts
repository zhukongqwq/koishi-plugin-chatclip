/**
 * 文字渲染缝：clip list 的列表文本与 clip show --text 的详情文本。
 * 这些是纯函数，断言的就是用户屏幕上看到的那几行字。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderDetail, renderList, summaryText, truncate } from '../src/render/text'
import { makeClip, makeSnapshot, now } from './helpers'
import type { Snapshot } from '../src/db'

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`

test('truncate 保留 25 字，超出补省略号', () => {
  const text = '一二三四五六七八九十一二三四五六七八九十一二三四五'
  assert.equal(text.length, 25)
  assert.equal(truncate(text, 25), text)

  const longer = text + '六七八'
  assert.equal(truncate(longer, 25), text + '…')
})

test('truncate 把换行压成空格', () => {
  assert.equal(truncate('第一行\n第二行', 25), '第一行 第二行')
})

test('summaryText 去掉媒体占位符', () => {
  assert.equal(summaryText('[图片]\n升级成功！[文件]'), '升级成功！')
})

test('summaryText 没有文字时按有无转发降级', () => {
  assert.equal(summaryText('[图片][文件]', false), '[无文字内容]')
  assert.equal(summaryText('', true), '[合并转发]')
})

test('renderList 头行与条目格式', () => {
  const createdAt = new Date(now - 60_000)
  const items = [{
    clip: makeClip({ id: 7, visibility: 'private', createdAt }),
    messages: [makeSnapshot({ content: '这个渲染函数我改完了，你看一下 👇', timestamp: createdAt })],
  }]

  const text = renderList(items, { page: 1, pageSize: 10, total: 1 })
  const lines = text.split('\n')

  assert.equal(lines[0], '📚 我的收藏 · 共 1 条 · 第 1/1 页')
  assert.equal(lines[1], '─────────────')
  assert.equal(lines[2], `#A0007 · 白露 · 今天 ${clock(createdAt)} · 仅自己`)
  assert.equal(lines[3], '  这个渲染函数我改完了，你看一下 👇')
  assert.ok(text.includes('clip show #A0007 渲染单条 · clip list 2 下一页'))
})

test('renderList 摘要超过 25 字截断，并列出引用与图片', () => {
  const createdAt = new Date(now - 60_000)
  const items = [{
    clip: makeClip({ id: 12, visibility: 'channel' }),
    messages: [
      makeSnapshot({
        content: '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十',
        timestamp: createdAt,
        elements: [
          { type: 'text', attrs: { content: '正文' } },
          { type: 'img', attrs: { src: 'https://example.com/a.png' } },
        ],
      }),
      makeSnapshot({
        seq: 1,
        role: 'quote',
        content: '气泡宽度要跟着内容走，别写死 480px',
        timestamp: createdAt,
      }),
    ],
  }]

  const text = renderList(items, { page: 2, pageSize: 5, total: 11 })
  assert.ok(text.startsWith('📚 我的收藏 · 共 11 条 · 第 2/3 页'))
  assert.ok(text.includes('  一二三四五六七八九十一二三四五六七八九十一二三四五…'))
  assert.ok(text.includes('  ↳ 引用 白露：气泡宽度要跟着内容走，别写死… · 图 ×1'))
})

test('renderList 空列表给出去空提示', () => {
  const text = renderList([], { page: 1, pageSize: 10, total: 0 })
  assert.ok(text.startsWith('📭 没有找到符合条件的收藏。'))
  assert.ok(text.includes('clip list'))
})

test('renderDetail 带序号、引用前缀与转发缩进', () => {
  const createdAt = new Date(now - 60_000)
  const messages: Snapshot[] = [
    makeSnapshot({ content: '这个渲染函数我改完了', timestamp: createdAt }),
    makeSnapshot({ seq: 1, role: 'quote', content: '气泡宽度要跟着内容走', timestamp: createdAt }),
    makeSnapshot({ seq: 2, role: 'forward', depth: 1, content: '外层一', timestamp: createdAt }),
    makeSnapshot({ seq: 3, role: 'forward', depth: 2, content: '内层一', timestamp: createdAt }),
  ]

  const text = renderDetail(makeClip({ id: 3, messageCount: 4 }), messages, 2)
  const lines = text.split('\n')

  assert.equal(lines[0], `#A0003 · 白露 · ${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())} ${clock(createdAt)} · 仅自己`)
  assert.ok(lines.includes(`① 白露 · ${clock(createdAt)}`))
  assert.ok(lines.includes(`↳ ② 白露 · ${clock(createdAt)}`))
  assert.ok(lines.includes(`　③ 白露 · ${clock(createdAt)}`))
  assert.ok(lines.includes(`　　④ 白露 · ${clock(createdAt)}`))
  assert.equal(lines[lines.length - 1], '可见性 仅自己 · 附件 2 · 来源 前端交流群')
})
