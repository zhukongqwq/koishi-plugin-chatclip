/**
 * 测试夹具：统一的 App 构造、配置、消息与会话形状。
 * 运行方式：node -r esbuild-register --test tests/*.test.ts
 */
import { App, h } from 'koishi'
import { mkdirSync } from 'fs'
import { resolve } from 'path'
import * as chatclip from '../src'
import { DEFAULT_FONT } from '../src/config'
import type { Clip, Snapshot } from '../src/db'
import type { CollectSource } from '../src/collect'

const root = resolve(__dirname, '../.tmp-test')

export function load(name: string) {
  const mod = require(name)
  return mod.default ?? mod
}

export interface AppOptions {
  assets?: boolean
  name?: string
}

/** 起一个只有数据库/存储的最小 App，插件自己的表由 applyTables 建好。 */
export async function createApp(options: AppOptions = {}) {
  const name = options.name ?? 'test'
  mkdirSync(root, { recursive: true })
  mkdirSync(resolve(root, `${name}-assets`), { recursive: true })
  const app = new App({ root } as any)
  app.plugin(load('@koishijs/plugin-http'), {})
  app.plugin(load('@koishijs/plugin-server'), { port: 0, host: '127.0.0.1' })
  app.plugin(load('@koishijs/plugin-database-sqlite'), { path: resolve(root, `${name}.db`) })
  if (options.assets !== false) {
    app.plugin(load('koishi-plugin-assets-local'), {
      root: resolve(root, `${name}-assets`),
      selfUrl: 'http://127.0.0.1:5140',
    })
  }
  app.plugin(chatclip, { defaultVisibility: 'private' })
  await app.start()
  return app
}

/** 与插件默认配置一致的最小配置对象。 */
export function makeConfig(overrides: Record<string, any> = {}): any {
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
    ...overrides,
  }
}

export function makeSource(message: any, extra: Partial<CollectSource> = {}): CollectSource {
  return {
    platform: 'onebot',
    channelId: '123456789',
    guildId: '123456789',
    guildName: '前端交流群',
    channelName: '前端交流群',
    ownerId: '10001',
    ownerName: '白露',
    bot: fakeBot,
    message,
    ...extra,
  }
}

/** 假的转发查询接口：按 id 返回消息数组。 */
export const fakeBot: any = {
  internal: {
    getForwardMsg: async () => [],
  },
}

export function botReturning(map: Record<string, any[]>) {
  return {
    internal: {
      getForwardMsg: async (id: string) => map[id] ?? [],
    },
  }
}

const now = Date.now()

export function textMessage(content: string, extra: Record<string, any> = {}) {
  return {
    id: extra.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    content,
    elements: [h.text(content)],
    user: { id: '10001', name: 'bailu', nickname: '白露' },
    timestamp: new Date(now - 60_000),
    ...extra,
  }
}

export function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 1,
    platform: 'onebot',
    channelId: '123456789',
    messageId: 'msg-1',
    ownerId: '10001',
    ownerName: '白露',
    visibility: 'private',
    messageCount: 1,
    createdAt: new Date(now - 60_000),
    meta: { channelName: '前端交流群' },
    degraded: [],
    ...overrides,
  } as Clip
}

export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const content = overrides.content ?? '你好'
  return {
    id: 1,
    clipId: 1,
    seq: 0,
    role: 'main',
    messageId: 'msg-1',
    userId: '10001',
    username: 'bailu',
    nickname: '白露',
    avatar: '',
    quoteDepth: 0,
    depth: 0,
    degraded: [],
    timestamp: new Date(now - 60_000),
    ...overrides,
    content,
    // 渲染走 elements，text 只是它的扁平副本：除非用例显式给了 elements，否则按 content 生成
    elements: overrides.elements ?? [{ type: 'text', attrs: { content } }],
  } as Snapshot
}

export { now }
