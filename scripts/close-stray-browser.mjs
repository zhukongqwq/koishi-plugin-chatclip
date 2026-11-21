// 关闭遗留的 puppeteer 浏览器：node scripts/close-stray-browser.mjs
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import puppeteer from 'puppeteer-core'

const base = tmpdir()
const dirs = readdirSync(base).filter((name) => name.startsWith('puppeteer_dev_chrome_profile-'))
console.log('profiles:', dirs.length)

for (const name of dirs) {
  const portFile = join(base, name, 'DevToolsActivePort')
  if (!existsSync(portFile)) {
    console.log(' -', name, 'no DevToolsActivePort (stale)')
    continue
  }
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim()
  try {
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null })
    const pages = await browser.pages()
    console.log(' -', name, 'port', port, 'pages', pages.length, pages.map((p) => p.url()).join(' | '))
    await browser.close()
    console.log('   closed')
  } catch (error) {
    console.log(' -', name, 'skip:', String(error && error.message).split('\n')[0])
  }
}
process.exit(0)
