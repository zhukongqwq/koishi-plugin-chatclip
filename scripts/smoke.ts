/**
 * 冒烟测试：不接聊天平台，直接跑「采集 → 落库 → 查询 → 文字渲染 → 图片渲染」。
 * 运行：node -r esbuild-register scripts/smoke.ts
 */
import { App, h } from 'koishi'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import * as chatclip from '../src'
import { collectClip, persistClip, loadClip, type CollectSource } from '../src/collect'
import { queryClips } from '../src/db'
import { renderClip } from '../src/render'
import { renderDetail, renderList } from '../src/render/text'

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
    reaction: false,
    reactionEmoji: '📌',
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
