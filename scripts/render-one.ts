/**
 * 用真实数据库里的某条收藏渲一张图：node -r esbuild-register scripts/render-one.ts [id] [out]
 */
import { App } from 'koishi'
import { resolve } from 'path'
import { writeFileSync } from 'fs'
import * as chatclip from '../src'
import { loadClip } from '../src/collect'
import { renderClip } from '../src/render'

const root = resolve(__dirname, '../../..')
const id = Number(process.argv[2] || 2)
const out = process.argv[3] || 'docs/preview/card-multi.png'

function load(name: string) {
  const mod = require(name)
  return mod.default ?? mod
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
  app.plugin(load('@koishijs/plugin-server'), { port: 5397, host: '127.0.0.1' })
  app.plugin(load('@koishijs/plugin-database-sqlite'), { path: resolve(root, 'data/koishi.db') })
  app.plugin(load('koishi-plugin-assets-local'), {
    root: resolve(root, 'data/assets'),
    selfUrl: 'http://127.0.0.1:5140',
  })
  app.plugin(load('koishi-plugin-puppeteer'), {})
  app.plugin(chatclip, { defaultVisibility: 'private' })
  await app.start()

  const loaded = await loadClip(app, id)
  if (!loaded) {
    console.log('clip not found:', id)
    process.exit(1)
  }
  const result = await renderClip(app, config, loaded.clip, loaded.messages)
  if (!result.image) {
    console.log('no image:', result.reason)
    process.exit(1)
  }
  const base64 = result.image.replace(/^.*base64,/, '').replace(/".*$/, '')
  writeFileSync(resolve(root, 'external/chatclip', out), Buffer.from(base64, 'base64'))
  console.log('saved', out)
  process.exit(0)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
