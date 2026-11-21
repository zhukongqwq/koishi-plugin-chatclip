/**
 * 验证 protectFilter 能识别并修复 loader 的 filter 自引用：
 * node -r esbuild-register scripts/filter-guard.ts
 */
import { Context } from 'koishi'
import { protectFilter } from '../src'

const probe = { resolve: () => true } as any

// 1. 正常上下文：不应被改动
const normal = new Context()
const normalBefore = normal.filter
protectFilter(normal)
console.log('normal untouched:', normal.filter === normalBefore, 'value:', normal.filter(probe))

// 2. 模拟 loader 的自引用：ctx.filter = (s) => ctx.filter(s) && true
const cycled = new Context()
;(cycled as any).filter = (session: any) => (cycled as any).filter(session) && true
let threw = false
try {
  ;(cycled as any).filter(probe)
} catch (error: any) {
  threw = error instanceof RangeError
}
console.log('cycle reproduced:', threw)

protectFilter(cycled)
console.log('after protect:', (cycled as any).filter(probe))

// 3. 继承链上的自引用（fork 场景）
const parent = new Context()
;(parent as any).filter = (session: any) => (parent as any).filter(session)
const child = parent.extend()
try {
  ;(child as any).filter(probe)
  console.log('child inherited cycle: NOT detected (unexpected)')
} catch (error: any) {
  console.log('child inherited cycle:', error instanceof RangeError)
}
protectFilter(child)
console.log('child after protect:', (child as any).filter(probe))
process.exit(0)
