// 控制台端到端检查：node scripts/e2e-console.mjs
import puppeteer from 'puppeteer-core'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const here = resolve(fileURLToPath(import.meta.url), '..')
const downloadDir = resolve(here, '../.tmp-download')
rmSync(downloadDir, { recursive: true, force: true })
mkdirSync(downloadDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[page error]', msg.text())
})
await page.setViewport({ width: 1440, height: 900 })
const client = await page.createCDPSession()
await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })

await page.goto('http://127.0.0.1:5140/chatclip', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 2500))

const rowCount = () => page.evaluate(() => document.querySelectorAll('.el-table__body tr').length)
const headers = () => page.evaluate(() => Array.from(document.querySelectorAll('.el-table__body tr')).map((tr) => tr.textContent?.replace(/\s+/g, ' ').trim().slice(0, 40)))

console.log('[all]', await rowCount(), 'rows')

// 1. 关键词搜索
await page.type('.el-input__inner', '渲染')
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === '查询')
  btn?.click()
})
await new Promise((r) => setTimeout(r, 1500))
console.log('[keyword 渲染]', await rowCount(), await headers())

// 2. 重置 + 可见性筛选
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === '重置')
  btn?.click()
})
await new Promise((r) => setTimeout(r, 1200))
console.log('[reset]', await rowCount())

await page.evaluate(() => {
  const select = document.querySelectorAll('.el-select')[0]
  const wrapper = select && select.querySelector('.el-select__wrapper')
  if (wrapper) wrapper.click()
})
await new Promise((r) => setTimeout(r, 600))
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('.el-select-dropdown__item'))
  const target = items.find((node) => node.textContent?.trim() === '公开')
  if (target) target.click()
})
await new Promise((r) => setTimeout(r, 400))
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === '查询')
  btn?.click()
})
await new Promise((r) => setTimeout(r, 1200))
console.log('[visibility 公开]', await rowCount(), await headers())

// 3. 导出 JSON
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === '重置')
  btn?.click()
})
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('.el-table__body tr'))
  const row = rows.find((tr) => tr.textContent?.includes('#A0001'))
  const btn = Array.from(row?.querySelectorAll('button') ?? []).find((node) => node.textContent?.trim() === 'JSON')
  btn?.click()
})
await new Promise((r) => setTimeout(r, 2500))
const files = readdirSync(downloadDir)
console.log('[download]', files)
if (files.length) {
  const content = readFileSync(resolve(downloadDir, files[0]), 'utf8')
  console.log('[download head]', content.slice(0, 120).replace(/\s+/g, ' '))
}

await browser.close()
process.exit(0)
