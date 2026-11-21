/**
 * 采集缝：把一条入站消息（含引用、合并转发、图片）变成可入库的快照。
 * 断言的是「收藏到什么」，不是内部队列怎么走。
 */
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { h } from 'koishi'
import {
  collectClip,
  countMessages,
  persistClip,
} from '../src/collect'
import { TABLES, queryClips } from '../src/db'
import { botReturning, createApp, makeConfig, makeSource, textMessage } from './helpers'

let app: any

before(async () => {
  app = await createApp({ name: 'collect', assets: false })
})

after(async () => {
  await app.stop()
})

beforeEach(async () => {
  await app.database.remove(TABLES.message, {})
  await app.database.remove(TABLES.attachment, {})
  await app.database.remove(TABLES.clip, {})
})

let counter = 0

function uniqueMessage(content: string, extra: Record<string, any> = {}) {
  counter += 1
  return textMessage(content, { id: `m-${counter}`, ...extra })
}

/** 造一条引用链：main → q1 → q2 … */
function withQuotes(depth: number) {
  const base = Date.now() - 10 * 60_000
  let node: any
  for (let index = depth; index >= 1; index--) {
    node = {
      id: `q-${index}`,
      content: `第 ${index} 层引用`,
      elements: [h.text(`第 ${index} 层引用`)],
      user: { id: `2000${index}`, name: `user${index}`, nickname: `用户${index}` },
      timestamp: new Date(base + index * 1000),
      ...(node ? { quote: node } : {}),
    }
  }
  return uniqueMessage('主消息', { quote: node, timestamp: new Date(base) })
}

test('引用链按 quoteDepth 展开', async () => {
  const message = withQuotes(3)

  const one = await collectClip(app, makeConfig({ quoteDepth: 1 }), makeSource(message), 'private')
  assert.equal(one.messages.length, 2)
  assert.deepEqual(one.messages.map((m: any) => m.role), ['main', 'quote'])

  const two = await collectClip(app, makeConfig({ quoteDepth: 2 }), makeSource(message), 'private')
  assert.equal(two.messages.length, 3)
  assert.deepEqual(two.messages.map((m: any) => m.quoteDepth), [0, 1, 2])

  const none = await collectClip(app, makeConfig({ quoteDepth: 0 }), makeSource(message), 'private')
  assert.equal(none.messages.length, 1)
})

test('引用自环不会无限展开', async () => {
  const loop: any = {
    id: 'loop-1',
    content: '循环引用',
    elements: [h.text('循环引用')],
    user: { id: '20001', name: 'loop', nickname: '循环' },
    timestamp: new Date(),
  }
  loop.quote = loop

  const collected = await collectClip(app, makeConfig({ quoteDepth: 3 }), makeSource(uniqueMessage('主消息', { quote: loop })), 'private')
  assert.equal(collected.messages.length, 2)
})

test('引用缺发送者或时间时标记降级', async () => {
  const quote = { id: 'q-bare', content: '匿名引用', elements: [h.text('匿名引用')] }
  const collected = await collectClip(app, makeConfig(), makeSource(uniqueMessage('主消息', { quote })), 'private')

  assert.ok(collected.degraded.includes('quote-incomplete'))
})

test('条数口径：纯转发的空壳主消息不算一条', () => {
  const text = { role: 'main' as const, content: '有文字' }
  const empty = { role: 'main' as const, content: '' }
  const forward = { role: 'forward' as const, content: '转发内容' }

  assert.equal(countMessages([text]), 1)
  // 只有一条空正文、也没有转发（比如纯图片消息仍在正文里留了占位）时，它自身算一条
  assert.equal(countMessages([empty]), 1)
  assert.equal(countMessages([empty, forward, forward]), 2)
  assert.equal(countMessages([text, forward]), 2)
})

test('合并转发按 forwardDepth 逐层展开', async () => {
  const inner = [
    { message_id: 'n-1', sender: { user_id: '10003', card: '李四' }, time: 1, message: [{ type: 'text', data: { text: '内层一' } }] },
  ]
  const outer = [
    { message_id: 'o-1', sender: { user_id: '10002', card: '张三' }, time: 1, message: [{ type: 'text', data: { text: '外层一' } }] },
    { message_id: 'o-2', sender: { user_id: '10001', card: '白露' }, time: 1, message: [{ type: 'forward', data: { id: 'fwd-inner', content: inner } }] },
  ]
  const bot = botReturning({ 'fwd-outer': outer, 'fwd-inner': inner })
  const main = uniqueMessage('', { elements: [h('forward', { id: 'fwd-outer' })], user: { id: '10001', name: 'bailu', nickname: '白露' } })

  const shallow = await collectClip(app, makeConfig({ forwardDepth: 1 }), makeSource(main, { bot }), 'private')
  assert.deepEqual(shallow.messages.map((m: any) => m.depth), [0, 1, 1])

  const deep = await collectClip(app, makeConfig({ forwardDepth: 2 }), makeSource(main, { bot }), 'private')
  assert.deepEqual(deep.messages.map((m: any) => m.depth), [0, 1, 1, 2])
  assert.deepEqual(deep.messages.map((m: any) => m.content), ['', '外层一', '', '内层一'])
})

test('转发条数超过 forwardLimit 时标记截断', async () => {
  const nodes = Array.from({ length: 4 }, (_, index) => ({
    message_id: `f-${index}`,
    sender: { user_id: '10002', card: '张三' },
    time: 1,
    message: [{ type: 'text', data: { text: `第 ${index} 条` } }],
  }))
  const bot = botReturning({ 'fwd-1': nodes })
  const main = uniqueMessage('', { elements: [h('forward', { id: 'fwd-1' })] })

  const collected = await collectClip(app, makeConfig({ forwardLimit: 2 }), makeSource(main, { bot }), 'private')
  assert.equal(collected.messages.filter((m: any) => m.role === 'forward').length, 2)
  assert.ok(collected.degraded.includes('forward-truncated'))
})

test('拿不到转发明细时降级而不是报错', async () => {
  const bot = { internal: {} }
  const main = uniqueMessage('', { elements: [h('forward', { id: 'fwd-missing' })] })

  const collected = await collectClip(app, makeConfig(), makeSource(main, { bot }), 'private')
  assert.ok(collected.degraded.includes('forward-unavailable'))
  assert.equal(collected.messages.length, 1)
})

test('转发里的 QQ 号会补出头像地址', async () => {
  const nodes = [
    { message_id: 'a-1', sender: { user_id: '10002', card: '张三' }, time: 1, message: [{ type: 'text', data: { text: '有头像' } }] },
  ]
  const bot = botReturning({ 'fwd-1': nodes })
  const main = uniqueMessage('', { elements: [h('forward', { id: 'fwd-1' })], user: { id: '10001', name: 'bailu', nickname: '白露' } })

  const collected = await collectClip(app, makeConfig(), makeSource(main, { bot }), 'private')
  const child = collected.messages.find((m: any) => m.role === 'forward')
  assert.equal(child.avatar, 'https://q1.qlogo.cn/g?b=qq&nk=10002&s=100')
  assert.equal(collected.messages[0].avatar, 'https://q1.qlogo.cn/g?b=qq&nk=10001&s=100')
})

test('同一条消息收藏两次是幂等的', async () => {
  const message = uniqueMessage('幂等测试')
  const collected = await collectClip(app, makeConfig(), makeSource(message), 'private')

  const first = await persistClip(app, collected)
  const second = await persistClip(app, collected)

  assert.equal(first.existing, false)
  assert.equal(second.existing, true)
  assert.equal(first.clip.id, second.clip.id)
  const list = await queryClips(app, { includeDeleted: true }, 1, 10)
  assert.equal(list.total, 1)
})

test('软删除后重新收藏会从回收站拉回来', async () => {
  const message = uniqueMessage('回收站')
  const collected = await collectClip(app, makeConfig(), makeSource(message), 'private')
  const first = await persistClip(app, collected)
  await app.database.set(TABLES.clip, { id: first.clip.id }, { deletedAt: new Date() })

  const again = await persistClip(app, collected)
  assert.equal(again.restored, true)
  assert.equal(again.existing, false)
  assert.equal(again.clip.id, first.clip.id)

  const list = await queryClips(app, {}, 1, 10)
  assert.equal(list.total, 1)
})

test('落库写入展示编号与条数', async () => {
  const collected = await collectClip(app, makeConfig(), makeSource(uniqueMessage('编号')), 'private')
  const { clip } = await persistClip(app, collected)
  assert.equal(clip.no, 1)
  assert.equal(clip.messageCount, 1)

  const second = await persistClip(app, await collectClip(app, makeConfig(), makeSource(uniqueMessage('第二条')), 'private'))
  assert.equal(second.clip.no, 2)
})
