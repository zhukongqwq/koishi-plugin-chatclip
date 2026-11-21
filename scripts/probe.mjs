// 检查页面加载失败原因：node scripts/probe.mjs [url]
import puppeteer from 'puppeteer-core'

const url = process.argv[2] || 'http://127.0.0.1:5140/chatclip'

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
page.on('console', (msg) => console.log('[console]', msg.type(), msg.text().slice(0, 300)))
page.on('pageerror', (error) => console.log('[pageerror]', String(error).slice(0, 300)))
page.on('requestfailed', (req) => console.log('[failed]', req.url(), req.failure()?.errorText))
page.on('response', (res) => {
  if (res.status() >= 400) console.log('[http]', res.status(), res.url())
})
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 3000))
console.log('[url]', page.url())
console.log('[title]', await page.title())
await browser.close()
process.exit(0)
