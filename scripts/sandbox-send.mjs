// 在沙箱里发送一条消息：node scripts/sandbox-send.mjs "/clip"
import puppeteer from 'puppeteer-core'

const text = process.argv[2] || '/clip'
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 860 })
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[page error]', msg.text())
})
await page.goto('http://127.0.0.1:5140/sandbox', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 2000))

if (!(await page.$('input[placeholder="发送消息到沙盒"]'))) {
  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll('button, a, span, div')).find((n) => n.textContent?.trim() === '添加用户')
    if (target) target.click()
  })
  await new Promise((r) => setTimeout(r, 1500))
}

const input = await page.$('input[placeholder="发送消息到沙盒"]')
if (!input) {
  console.log('no sandbox input found')
  process.exit(1)
}
await input.click()
await page.keyboard.type(text, { delay: 15 })
await page.keyboard.press('Enter')
console.log('sent:', text)
await new Promise((r) => setTimeout(r, 4000))
await page.screenshot({ path: 'docs/preview/sandbox-send.png' })
await new Promise((r) => setTimeout(r, 3000))
await browser.close()
process.exit(0)
