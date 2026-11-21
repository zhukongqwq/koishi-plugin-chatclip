// 把 docs/flow.html 截成图片：node scripts/shot-flow.mjs [out]
import puppeteer from 'puppeteer-core'
import { resolve, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const out = resolve(__dirname, '..', process.argv[2] || '.preview/flow.png')
const source = pathToFileURL(resolve(__dirname, '../docs/flow.html')).href

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1180, height: 1400, deviceScaleFactor: 2 })
await page.goto(source, { waitUntil: 'networkidle0', timeout: 60000 })
await new Promise((r) => setTimeout(r, 400))
await page.screenshot({ path: out, fullPage: true })
console.log('saved', out)
await browser.close()
process.exit(0)
