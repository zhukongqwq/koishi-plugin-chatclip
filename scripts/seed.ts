/**
 * 往开发用数据库里塞几条假收藏，方便在控制台里看页面效果。
 * 运行：node -r esbuild-register scripts/seed.ts
 */
import { App, h } from 'koishi'
import { resolve } from 'path'
import * as chatclip from '../src'
import { collectClip, persistClip, type CollectSource } from '../src/collect'

const root = resolve(__dirname, '../../..')

function load(name: string) {
  const mod = require(name)
  return mod.default ?? mod
}

function svg(label: string, from: string, to: string, w = 480, hh = 300) {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
<rect width="${w}" height="${hh}" rx="16" fill="url(#g)"/>
<text x="${w / 2}" y="${hh / 2 + 10}" font-family="sans-serif" font-size="26" fill="#fff" text-anchor="middle">${label}</text></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(source).toString('base64')
}

const now = Date.now()

const quote = {
  id: 'msg-quote-1',
  content: '气泡宽度要跟着内容走，别写死 480px',
  elements: [h.text('气泡宽度要跟着内容走，别写死 480px')],
  user: { id: '10002', name: 'zhang', nickname: '张三' },
  timestamp: new Date(now - 30 * 60_000),
}

const messages = [
  {
    id: 'seed-1',
    content: '这个渲染函数我改完了，你看一下 👇',
    elements: [
      h.text('这个渲染函数我改完了，你看一下 👇'),
      h.image(svg('修复前 / 修复后', '#a5b4fc', '#818cf8')),
      h('file', { src: svg('log', '#fbcfe8', '#f9a8d4', 200, 140), name: 'error.log' }),
    ],
    user: { id: '10001', name: 'bailu', nickname: '白露', avatar: svg('白', '#818cf8', '#6366f1', 200, 200) },
    timestamp: new Date(now - 20 * 60_000),
    quote,
  },
  {
    id: 'seed-2',
    content: '这三张图是同一个 bug，你看第一张就明白了……',
    elements: [
      h.text('这三张图是同一个 bug，你看第一张就明白了……'),
      h.image(svg('1', '#bfdbfe', '#60a5fa')),
      h.image(svg('2', '#fde68a', '#fbbf24')),
      h.image(svg('3', '#bbf7d0', '#34d399')),
    ],
    user: { id: '10002', name: 'zhang', nickname: '张三' },
    timestamp: new Date(now - 3 * 3600_000),
    quote: {
      id: 'msg-quote-2',
      content: '好，修完记得跑一遍 yarn build',
      elements: [h.text('好，修完记得跑一遍 yarn build')],
      user: { id: '10001', name: 'bailu', nickname: '白露' },
      timestamp: new Date(now - 3.2 * 3600_000),
    },
  },
  {
    id: 'seed-3',
    content: '升级成功！',
    elements: [h.text('升级成功！')],
    user: { id: '1277629216', name: 'fengling', nickname: '风铃', avatar: svg('风', '#fda4af', '#fb7185', 200, 200) },
    timestamp: new Date(now - 26 * 3600_000),
  },
]

const bot = {
  internal: {
    getForwardMsg: async () => [
      {
        message_id: 'f-1',
        sender: { user_id: '10002', card: '张三' },
        time: Math.floor((now - 5 * 3600_000) / 1000),
        message: [{ type: 'text', data: { text: '记得先 yarn build，不然 dist 不会更新' } }],
      },
    ],
  },
}

function makeSource(message: any, index: number): CollectSource {
  return {
    platform: 'onebot',
    channelId: index === 2 ? '987654321' : '123456789',
    guildId: index === 2 ? '987654321' : '123456789',
    guildName: index === 2 ? '摸鱼群' : '前端交流群',
    channelName: index === 2 ? '摸鱼群' : '前端交流群',
    ownerId: '10001',
    ownerName: '白露',
    bot,
    message,
  }
}

const config = {
  defaultVisibility: 'private',
  quoteDepth: 3,
  forwardDepth: 1,
  forwardLimit: 50,
  allowPrivate: true,
  allowGroup: true,
  storage: true,
  maxAssetSize: 10 * 1024 * 1024,
  reaction: false,
  reactionEmoji: '📌',
  pageSize: 10,
  maxClipsPerUser: 0,
  imageWidth: 720,
} as any

async function run() {
  const app = new App({ root } as any)
  app.plugin(load('@koishijs/plugin-http'), {})
  app.plugin(load('@koishijs/plugin-server'), { port: 5398, host: '127.0.0.1' })
  app.plugin(load('@koishijs/plugin-database-sqlite'), { path: resolve(root, 'data/koishi.db') })
  app.plugin(load('koishi-plugin-assets-local'), {
    root: resolve(root, 'data/assets'),
    selfUrl: 'http://127.0.0.1:5140',
  })
  app.plugin(chatclip, { defaultVisibility: 'private' })
  await app.start()

  const visibilities: any[] = ['private', 'channel', 'public']
  let index = 0
  for (const message of messages) {
    const source = makeSource(message, index)
    const collected = await collectClip(app, config, source, visibilities[index % 3])
    const result = await persistClip(app, collected)
    console.log(`[seed] ${index + 1} id=${result.clip.id} existing=${result.existing}`)
    index++
  }

  // 一条合并转发
  const forwardSource = makeSource(
    {
      id: 'seed-4',
      content: '',
      elements: [h('forward', { id: 'fwd-1' })],
      user: { id: '10001', name: 'bailu', nickname: '白露' },
      timestamp: new Date(now - 5 * 3600_000),
    },
    1,
  )
  const forwarded = await collectClip(app, config, forwardSource, 'private')
  const forwardResult = await persistClip(app, forwarded)
  console.log('[seed] forward id=', forwardResult.clip.id)

  process.exit(0)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
