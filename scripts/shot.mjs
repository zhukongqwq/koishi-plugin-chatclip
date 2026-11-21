// 用本机 Edge 给控制台页面截图：node scripts/shot.mjs [url] [out] [width] [height]
import puppeteer from 'puppeteer-core'

const url = process.argv[2] || 'http://127.0.0.1:5140/chatclip'
const out = process.argv[3] || 'docs/preview/console.png'
const width = Number(process.argv[4] || 1440)
const height = Number(process.argv[5] || 900)

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width, height, deviceScaleFactor: 2 })
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 2500))
await page.screenshot({ path: out })
console.log('saved', out)
await browser.close()
process.exit(0)
