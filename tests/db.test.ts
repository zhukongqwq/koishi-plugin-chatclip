/**
 * 查询缝：编号补位、回收站、按展示编号解析、关键词/发送者筛选。
 * 跑在内存 sqlite 上（真实表结构，由 applyTables 建）。
 */
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  TABLES,
  clipNo,
  formatClipId,
  nextClipNo,
  purgeClips,
  queryClips,
  renumberClips,
  resolveClipRef,
} from '../src/db'
import { createApp } from './helpers'

let app: any

before(async () => {
  app = await createApp({ name: 'db', assets: false })
})

after(async () => {
  await app.stop()
})

beforeEach(async () => {
  await app.database.remove(TABLES.message, {})
  await app.database.remove(TABLES.attachment, {})
  await app.database.remove(TABLES.clip, {})
})

let seq = 0

/** 插一条收藏（可选内容与发送者），返回数据库行。 */
async function insertClip(options: {
  content?: string
  nickname?: string
  ownerId?: string
  deleted?: boolean
  no?: number
  createdAt?: Date
} = {}) {
  seq += 1
  const createdAt = options.createdAt ?? new Date(Date.now() + seq * 1000)
  const clip = await app.database.create(TABLES.clip, {
    platform: 'onebot',
    channelId: '123456789',
    messageId: `m-${seq}`,
    ownerId: options.ownerId ?? '10001',
    ownerName: options.nickname ?? '白露',
    visibility: 'private',
    messageCount: 1,
    createdAt,
    degraded: [],
    meta: {},
    ...(options.no ? { no: options.no } : {}),
    ...(options.deleted ? { deletedAt: new Date() } : {}),
  })
  await app.database.create(TABLES.message, {
    clipId: clip.id,
    seq: 0,
    role: 'main',
    messageId: `m-${seq}`,
    userId: options.ownerId ?? '10001',
    username: options.nickname ?? 'bailu',
    nickname: options.nickname ?? '白露',
    avatar: '',
    content: options.content ?? '正文',
    elements: [{ type: 'text', attrs: { content: options.content ?? '正文' } }],
    timestamp: createdAt,
    quoteDepth: 0,
    depth: 0,
    degraded: [],
  })
  return clip
}

test('展示编号从 1 开始递增', async () => {
  await insertClip({ no: 1 })
  await insertClip({ no: 2 })
  assert.equal(await nextClipNo(app), 3)
})

test('renumberClips 把空洞补上', async () => {
  const first = await insertClip({ no: 1 })
  const third = await insertClip({ no: 3 })
  const fourth = await insertClip({ no: 4 })

  const total = await renumberClips(app)
  assert.equal(total, 3)

  const rows = await app.database.get(TABLES.clip, {}, { sort: { createdAt: 'asc' } })
  assert.deepEqual(rows.map((row: any) => row.no), [1, 2, 3])
  assert.deepEqual(rows.map((row: any) => row.id), [first.id, third.id, fourth.id])
})

test('purgeClips 只删软删除的，删完自动补号', async () => {
  const kept = await insertClip({ no: 1 })
  const removed = await insertClip({ no: 2, deleted: true })
  const tail = await insertClip({ no: 3 })

  const blocked = await purgeClips(app, { ids: [kept.id] })
  assert.deepEqual(blocked.ids, [])
  assert.deepEqual(blocked.skipped, [kept.id])

  const purged = await purgeClips(app, { ids: [removed.id] })
  assert.deepEqual(purged.ids, [removed.id])

  const rows = await app.database.get(TABLES.clip, {}, { sort: { createdAt: 'asc' } })
  assert.deepEqual(rows.map((row: any) => row.id), [kept.id, tail.id])
  assert.deepEqual(rows.map((row: any) => row.no), [1, 2])
  assert.equal(await app.database.get(TABLES.message, { clipId: removed.id }).then((r: any[]) => r.length), 0)
})

test('purgeClips all 清空整个回收站', async () => {
  await insertClip({ no: 1, deleted: true })
  await insertClip({ no: 2, deleted: true })
  const alive = await insertClip({ no: 3 })

  const result = await purgeClips(app, { all: true })
  assert.equal(result.ids.length, 2)
  const left = await queryClips(app, { includeDeleted: true }, 1, 10)
  assert.deepEqual(left.items.map((row: any) => row.id), [alive.id])
  assert.equal(clipNo(left.items[0]), 1)
})

test('resolveClipRef 认 #A0002、A0002、2', async () => {
  await insertClip({ no: 1 })
  const second = await insertClip({ no: 2 })

  for (const input of ['2', '#A0002', 'A0002', 'a0002']) {
    const found = await resolveClipRef(app, input)
    assert.equal(found?.id, second.id, `${input} 没解析到目标`)
  }

  assert.equal(await resolveClipRef(app, '不存在'), undefined)
  assert.equal(await resolveClipRef(app, '9'), undefined)
})

test('queryClips 默认不返回回收站，deletedOnly 只看回收站', async () => {
  const alive = await insertClip({ no: 1 })
  const dead = await insertClip({ no: 2, deleted: true })

  const normal = await queryClips(app, {}, 1, 10)
  assert.deepEqual(normal.items.map((row: any) => row.id), [alive.id])
  assert.equal(normal.total, 1)

  const recycle = await queryClips(app, { deletedOnly: true }, 1, 10)
  assert.deepEqual(recycle.items.map((row: any) => row.id), [dead.id])

  const all = await queryClips(app, { includeDeleted: true }, 1, 10)
  assert.equal(all.total, 2)
})

test('关键词与发送者落在消息表上，但结果回到收藏', async () => {
  const hit = await insertClip({ content: '这个渲染函数我改完了', nickname: '白露', no: 1 })
  await insertClip({ content: '升级成功！', nickname: '风铃', no: 2 })

  const byKeyword = await queryClips(app, { keyword: '渲染' }, 1, 10)
  assert.deepEqual(byKeyword.items.map((row: any) => row.id), [hit.id])

  const bySender = await queryClips(app, { from: ['风铃'] }, 1, 10)
  assert.equal(bySender.total, 1)
  assert.equal(formatClipId(clipNo(bySender.items[0])), '#A0002')
})

test('分页返回正确的总数与页内条数', async () => {
  for (let index = 0; index < 5; index++) await insertClip({ no: index + 1, content: `第 ${index} 条` })

  const page1 = await queryClips(app, { includeDeleted: true }, 1, 2)
  assert.equal(page1.total, 5)
  assert.equal(page1.items.length, 2)

  const page3 = await queryClips(app, { includeDeleted: true }, 3, 2)
  assert.equal(page3.items.length, 1)
})
