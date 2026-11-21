# ADR-0003：图片渲染用 puppeteer + 两套模板

**状态**：已接受（2026-11-20）

## 背景

`ctx.puppeteer.render(content, callback)` 只有两个参数、没有 theme，`content` 只能是字符串；默认 callback 截 `body`，而 puppeteer 包内的 `index.html` 的 body 是空的 —— 不自己写 callback 会得到一张 0 高的空白图。

## 决策

- 统一入口 `renderClip(clip): Promise<h>`：
  - `clip.messages.length === 1` → Card 模板（`docs/mockups/single-card.png`）；
  - `>= 2` → Bubble 模板（`docs/mockups/bubble.png`）；
  - 无 puppeteer 或渲染失败 → Text View，并 `logger.warn` 一次。
- 渲染必须传自定义 callback：

```ts
const img = await ctx.puppeteer.render(html, async (page, next) => {
  await page.setViewport({ width: 720, height: 200, deviceScaleFactor: 2 })
  await page.waitForNetworkIdle()
  return next(await page.$('.card'))
})
```

- 图片以 `data:image/png;base64,…` 字符串返回，交给 `session.send(img)`，由 `h.normalize` 转回 `<img>`；
- HTML 内联 `<style>`，不依赖 theme；附件用绝对 URL，`waitForNetworkIdle` 保证图片加载完再截。

## 后果

- 样式即 HTML，改版不用动渲染流程；
- 需要 `puppeteer` 插件启用；本机用 Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`），无需 `executablePath`；
- 每次渲染都是冷启动页面，慢（~1s），因此加一层进程内 LRU 缓存（**不做持久化**，样式改了立刻生效）。
