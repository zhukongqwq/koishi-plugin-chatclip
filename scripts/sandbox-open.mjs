// 打开沙箱、添加一个用户并保持连接：node scripts/sandbox-open.mjs [seconds]
import puppeteer from 'puppeteer-core'

const seconds = Number(process.argv[2] || 45)
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
await new Promise((r) => setTimeout(r, 1500))

const clicked = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('button, a, span, div'))
  const target = nodes.find((node) => node.textContent?.trim() === '添加用户')
  if (!target) return false
  target.click()
  return true
})
console.log('clicked 添加用户:', clicked)
await new Promise((r) => setTimeout(r, 2000))
await page.screenshot({ path: 'docs/preview/sandbox-1.png' })

// 截图后尝试在对话框里点确认
const confirmed = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('button'))
  const target = nodes.find((node) => /确定|确认|添加/.test(node.textContent?.trim() || ''))
  if (!target) return false
  target.click()
  return true
})
console.log('confirmed:', confirmed)
await new Promise((r) => setTimeout(r, 2000))
await page.screenshot({ path: 'docs/preview/sandbox-2.png' })

// 找到输入框并发送 clip
const typed = await page.evaluate(() => {
  const input = document.querySelector('textarea, input[type="text"]')
  if (!input) return false
  input.focus()
  return true
})
console.log('input focused:', typed)
if (typed) {
  await page.type('textarea, input[type="text"]', '/clip')
  await page.keyboard.press('Enter')
  console.log('sent /clip')
}
await new Promise((r) => setTimeout(r, 3000))
await page.screenshot({ path: 'docs/preview/sandbox-3.png' })

await new Promise((r) => setTimeout(r, seconds * 1000))
await browser.close()
process.exit(0)
