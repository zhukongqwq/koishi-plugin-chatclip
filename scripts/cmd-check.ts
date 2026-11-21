import { App } from 'koishi'
import { resolve } from 'path'
import * as chatclip from '../src'

const root = resolve(__dirname, '../../..')

function load(name: string) {
  const mod = require(name)
  return mod.default ?? mod
}

async function run() {
  const app = new App({ root } as any)
  app.plugin(load('@koishijs/plugin-database-sqlite'), { path: resolve(root, 'data/koishi.yml.test.db') })
  app.plugin(chatclip, {})
  await app.start()
  const list = app.$commander._commandList ?? []
  console.log('commands:', list.map((c: any) => c.name).join(', '))
  console.log('has clip.list:', !!app.$commander.get('clip.list'))
  const fake: any = {
    content: 'clip list',
    stripped: { content: 'clip list', prefix: '', mention: false, appel: false },
    selfId: 'bot',
    userId: 'u1',
    uid: 1,
    channelId: 'c1',
    isDirect: true,
    resolve: () => true,
  }
  fake.session = fake
  const cmd = app.$commander.resolve(fake)
  console.log('resolve =>', cmd?.name)
  process.exit(0)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
