/**
 * 冒烟测试：不接聊天平台，直接跑「采集 → 落库 → 查询 → 文字渲染 → 图片渲染」。
 * 运行：node -r esbuild-register scripts/smoke.ts
 */
import { App, h } from 'koishi'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { resolve } from 'path'
import * as chatclip from '../src'
import { collectClip, persistClip, loadClip, type CollectSource } from '../src/collect'
import { queryClips, purgeClips, resolveClipRef, clipNo, TABLES } from '../src/db'
import { renderClip } from '../src/render'
import { renderDetail, renderList } from '../src/render/text'
import { DEFAULT_FONT } from '../src/config'

const root = resolve(__dirname, '../.tmp-smoke')

function load(name: string) {
  const mod = require(name)
  return mod.default ?? mod
}

function svg(label: string, from: string, to: string) {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
<rect width="480" height="300" rx="16" fill="url(#g)"/>
<text x="240" y="160" font-family="sans-serif" font-size="28" fill="#fff" text-anchor="middle">${label}</text></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(source).toString('base64')
}

const now = Date.now()

const quote = {
  id: 'msg-quote-1',
  content: '气泡宽度要跟着内容走，别写死 480px',
  elements: [h.text('气泡宽度要跟着内容走，别写死 480px')],
  user: { id: '10002', name: 'zhang', nickname: '张三' },
  timestamp: new Date(now - 4 * 60_000),
}

const mainMessage = {
  id: 'msg-main-1',
  content: '这个渲染函数我改完了，你看一下 👇',
  elements: [
    h.text('这个渲染函数我改完了，你看一下 👇'),
    h.image(svg('修复前 / 修复后', '#a5b4fc', '#818cf8')),
    h('file', { src: svg('log', '#fbcfe8', '#f9a8d4'), name: 'error.log' }),
  ],
  user: { id: '10001', name: 'bailu', nickname: '白露', avatar: svg('白', '#818cf8', '#6366f1') },
  timestamp: new Date(now),
  quote,
}

const forwardNode = {
  message_id: 'f-1',
  sender: { user_id: '10002', card: '张三' },
  time: Math.floor((now - 60_000) / 1000),
  message: [
    { type: 'text', data: { text: '记得先 yarn build，不然 dist 不会更新' } },
  ],
}

const bot = {
  internal: {
    getForwardMsg: async () => [forwardNode],
  },
}

const forwardMain = {
  id: 'msg-main-2',
  content: '群聊的聊天记录',
  elements: [h('forward', { id: 'fwd-1' })],
  user: { id: '10001', name: 'bailu', nickname: '白露' },
  timestamp: new Date(now - 60_000),
}

// 嵌套转发：NapCat 会把内层的完整 content 塞进段数据里，这里模拟同样的形状
const innerNodes = [
  {
    message_id: 'n-1',
    sender: { user_id: '10003', card: '李四' },
    time: Math.floor((now - 300_000) / 1000),
    message: [{ type: 'text', data: { text: '内层：这个阈值我调过了' } }],
  },
  {
    message_id: 'n-2',
    sender: { user_id: '10002', card: '张三' },
    time: Math.floor((now - 290_000) / 1000),
    message: [
      { type: 'text', data: { text: '内层：那我看下日志 ' } },
      { type: 'image', data: { url: svg('内层图', '#bfdbfe', '#93c5fd') } },
    ],
  },
]

const outerNodes = [
  {
    message_id: 'o-1',
    sender: { user_id: '10002', card: '张三' },
    time: Math.floor((now - 120_000) / 1000),
    message: [{ type: 'text', data: { text: '外层：先看这条，然后下面这条是转发' } }],
  },
  {
    message_id: 'o-2',
    sender: { user_id: '10001', card: '白露' },
    time: Math.floor((now - 110_000) / 1000),
    message: [{ type: 'forward', data: { id: 'fwd-inner', content: innerNodes } }],
  },
]

const nestedBot = {
  internal: {
    getForwardMsg: async (id: string) => {
      if (id === 'fwd-outer') return outerNodes
      if (id === 'fwd-inner') return innerNodes
      return []
    },
  },
}

const nestedMain = {
  id: 'msg-main-3',
  content: '群聊的聊天记录',
  elements: [h('forward', { id: 'fwd-outer' })],
  user: { id: '10001', name: 'bailu', nickname: '白露' },
  timestamp: new Date(now - 150_000),
}

function makeSource(message: any, extra: Partial<CollectSource> = {}): CollectSource {
  return {
    platform: 'onebot',
    channelId: '123456789',
    guildId: '123456789',
    guildName: '前端交流群',
    channelName: '前端交流群',
    ownerId: '10001',
    ownerName: '白露',
    bot,
    message,
    ...extra,
  }
}

async function run() {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })

  // 大图用例需要真实 http 地址：data: URL 走内联分支，不会进转存逻辑
  const bigSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">' +
    '<rect width="900" height="600" fill="#6673ee"/>' + '<!--' + 'x'.repeat(300_000) + '--></svg>'
  const fileServer = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
    res.end(bigSvg)
  })
  await new Promise<void>((done) => fileServer.listen(5398, '127.0.0.1', done))

  const app = new App({ root } as any)
  app.plugin(load('@koishijs/plugin-http'), {})
  app.plugin(load('@koishijs/plugin-server'), { port: 5399, host: '127.0.0.1' })
  app.plugin(load('@koishijs/plugin-database-sqlite'), { path: resolve(root, 'test.db') })
  app.plugin(load('koishi-plugin-assets-local'), {
    root: resolve(root, 'assets'),
    selfUrl: 'http://127.0.0.1:5140',
  })
  app.plugin(load('koishi-plugin-puppeteer'), {})
  app.plugin(chatclip, { defaultVisibility: 'private' })

  await app.start()
  const ctx = app
  console.log('[env] puppeteer =', !!app.puppeteer, 'assets =', !!app.assets)

  // 1. 采集 + 落库
  const collected = await collectClip(ctx, config2(), makeSource(mainMessage), 'private')
  console.log('[collect] messages =', collected.messages.length, 'attachments =', collected.attachments.length)
  const first = await persistClip(ctx, collected)
  console.log('[persist] id =', first.clip.id, 'existing =', first.existing)

  // 2. 幂等
  const second = await persistClip(ctx, collected)
  console.log('[persist again] id =', second.clip.id, 'existing =', second.existing)

  // 3. 合并转发
  const forwarded = await collectClip(ctx, config2(), makeSource(forwardMain), 'private')
  console.log('[forward] messages =', forwarded.messages.length, 'degraded =', forwarded.degraded)
  const forwardClip = await persistClip(ctx, forwarded)
  console.log('[forward persist] id =', forwardClip.clip.id)

  // 3.2 嵌套转发：forwardDepth = 2 时应该把内层也展开，depth 依次为 1 / 2
  const nested = await collectClip(
    ctx,
    { ...config2(), forwardDepth: 2 },
    { ...makeSource(nestedMain), bot: nestedBot },
    'private',
  )
  console.log(
    '[nested forward] messages =', nested.messages.length,
    'depths =', nested.messages.map((item) => item.depth).join(','),
    'degraded =', nested.degraded,
  )
  const nestedClip = await persistClip(ctx, nested)

  // forwardDepth = 1 时内层应该不再展开
  const shallow = await collectClip(
    ctx,
    { ...config2(), forwardDepth: 1 },
    { ...makeSource({ ...nestedMain, id: 'msg-main-4' }), bot: nestedBot },
    'private',
  )
  console.log(
    '[shallow forward] messages =', shallow.messages.length,
    'depths =', shallow.messages.map((item) => item.depth).join(','),
  )

  // 3.5 引用链去重：适配器把「主消息自己」塞进 quote 时不能重复存
  const selfQuoted = await collectClip(
    ctx,
    config2(),
    makeSource({ ...mainMessage, id: 'msg-self-1', quote: quote }, { quote: undefined }),
    'private',
  )
  console.log('[self quote] messages =', selfQuoted.messages.length, '(2 = 主消息 + 一条引用)')
  const looped = await collectClip(
    ctx,
    config2(),
    makeSource({ ...mainMessage, id: 'msg-loop-1', quote: { ...quote, id: 'msg-loop-1' } }, { quote: undefined }),
    'private',
  )
  console.log('[quote loop] messages =', looped.messages.length, '(1 = 只有主消息)')

  // 3.7 本地转存大小上限：上限设成 0.00001 MB，任何图片都超限，应回退成原链接并记一条 degraded
  const tight = { ...config2(), maxLocalImageSize: 0.00001 }
  const oversized = await collectClip(
    ctx,
    tight,
    makeSource({
      id: 'msg-big-1',
      content: '一张大图 [图片]',
      elements: [
        h.text('一张大图 '),
        h('img', { src: 'http://127.0.0.1:5398/big.svg' }),
      ],
      user: { id: '10001', name: 'bailu', nickname: '白露' },
      timestamp: new Date(now - 30_000),
    }),
    'private',
  )
  console.log('[oversize] attachments =', oversized.attachments.length, 'note =', oversized.attachments[0]?.note, 'degraded =', oversized.degraded)

  // 4. 查询
  const listed = await queryClips(ctx, { includeDeleted: true }, 1, 10)
  console.log('[query] total =', listed.total)

  const searched = await queryClips(ctx, { keyword: '渲染', includeDeleted: true }, 1, 10)
  console.log('[search 渲染] total =', searched.total)

  const bySender = await queryClips(ctx, { from: ['白露'], includeDeleted: true }, 1, 10)
  console.log('[search 白露] total =', bySender.total)

  // 5. 文字视图
  const loaded = await loadClip(ctx, first.clip.id)
  const detailText = renderDetail(loaded.clip, loaded.messages, loaded.attachments.length)
  const listText = renderList([
    { clip: loaded.clip, messages: loaded.messages },
    { clip: forwardClip.clip, messages: forwarded.messages as any },
  ], { title: '我的收藏', page: 1, pageSize: 10, total: 2 })

  mkdirSync(resolve(__dirname, '../docs/preview'), { recursive: true })
  writeFileSync(resolve(__dirname, '../docs/preview/list.txt'), listText, 'utf8')
  writeFileSync(resolve(__dirname, '../docs/preview/detail.txt'), detailText, 'utf8')
  console.log('----- list -----')
  console.log(listText)
  console.log('----- detail -----')
  console.log(detailText)

  // 6. 图片渲染：单条大字卡 + 转发气泡
  const targets: [string, typeof loaded][] = [
    ['clip', loaded],
    ['bubble', await loadClip(ctx, forwardClip.clip.id) as any],
    ['forward-nested', await loadClip(ctx, nestedClip.clip.id) as any],
  ]
  for (const [name, target] of targets) {
    const result = await renderClip(ctx, config2(), target.clip, target.messages)
    if (result.image) {
      const base64 = result.image.replace(/^.*base64,/, '').replace(/".*$/, '')
      const buffer = Buffer.from(base64, 'base64')
      writeFileSync(resolve(__dirname, `../docs/preview/${name}.png`), buffer)
      console.log(`[render ${name}] image saved,`, buffer.length, 'bytes')
    } else {
      console.log(`[render ${name}] no image:`, result.reason)
    }
  }

  // 7. 编号：展示编号连续、按展示编号能查到、硬删除后自动补号
  const before = await queryClips(ctx, { includeDeleted: true }, 1, 10)
  console.log('[no]', before.items.map((clip) => clipNo(clip)).join(','))
  const byNo = await resolveClipRef(ctx, '1')
  console.log('[resolve 1] id =', byNo?.id, 'no =', byNo && clipNo(byNo))

  // 8. 回收站：软删除 → 只有软删除才能硬删除 → 清空
  await ctx.database.set(TABLES.clip, { id: first.clip.id }, { deletedAt: new Date() })
  const recycle = await queryClips(ctx, { deletedOnly: true }, 1, 10)
  console.log('[recycle] soft-deleted =', recycle.total)
  const blocked = await purgeClips(ctx, { ids: [forwardClip.clip.id] })
  console.log('[purge] not-yet-deleted skipped =', blocked.skipped.length, 'removed =', blocked.ids.length)
  const purged = await purgeClips(ctx, { all: true })
  console.log('[purge] recycle bin removed =', purged.ids.length)
  const remaining = await queryClips(ctx, { includeDeleted: true }, 1, 10)
  console.log('[purge] remaining =', remaining.total, 'no =', remaining.items.map((clip) => clipNo(clip)).join(','))

  // puppeteer 的 dispose 会与 browser 关闭竞争，冒烟脚本直接退出即可
  process.exit(0)
}

/** 与插件默认配置一致的最小配置对象。 */
function config2() {
  return {
    defaultVisibility: 'private',
    quoteDepth: 3,
    forwardDepth: 1,
    forwardLimit: 50,
    allowPrivate: true,
    allowGroup: true,
    storage: true,
    maxAssetSize: 10,
    maxLocalImageSize: 5,
    fontFamily: DEFAULT_FONT,
    textImageLimit: 6,
    pageSize: 10,
    maxClipsPerUser: 0,
    imageWidth: 720,
  } as any
}

const defaults = config2()

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
