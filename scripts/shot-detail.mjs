// 打开控制台并展开指定行的详情抽屉：node scripts/shot-detail.mjs [rowIndex] [out]
import puppeteer from 'puppeteer-core'

const wanted = process.argv[2] || '#A0001'
const out = process.argv[3] || 'docs/preview/console-detail.png'

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[page error]', msg.text())
})
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
await page.goto('http://127.0.0.1:5140/chatclip', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 2500))

const clicked = await page.evaluate((id) => {
  const rows = Array.from(document.querySelectorAll('tr'))
  const row = rows.find((tr) => tr.textContent?.includes(id))
  if (!row) return false
  const target = Array.from(row.querySelectorAll('a, span, button')).find((node) => node.textContent?.trim() === '查看')
  if (!target) return false
  target.click()
  return true
}, wanted)
console.log('clicked', wanted, ':', clicked)
await new Promise((r) => setTimeout(r, 2500))
await page.screenshot({ path: out })
console.log('saved', out)
await browser.close()
process.exit(0)
