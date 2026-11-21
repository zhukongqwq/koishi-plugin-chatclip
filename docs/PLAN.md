# chatclip 实施计划（v1）

访谈结论已固化在 [GLOSSARY.md](../GLOSSARY.md) 与 `docs/adr/0001~0004`。本文只写"要建什么"，不写"为什么"。

## 1. 范围

**做**：引用收藏（含引用链）、合并转发展开、图片/文件转存、文字视图、单条卡、多条气泡、按时间/用户/关键词筛选、控制台浏览与导出、软删除、幂等去重。

**不做**：标签（已砍）、自动收藏（表情回应已砍）、多用户权限体系（auth 关闭）、跨实例同步、消息编辑后刷新快照。

## 2. 数据模型

三张表，全部字段与索引在首版 `ctx.model.extend()` 中一次声明完（minato 不会补建 unique）。

### `chatclip_clip`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | unsigned, autoInc, primary | Clip 编号，展示为 `#A1024` 一类的短码或直接用 id |
| `platform` | string(32) | `onebot` / `discord` … |
| `channelId` | string(64) | 群号或 `private:<uid>` |
| `guildId` | string(64), nullable | |
| `messageId` | string(64) | 主消息 id |
| `ownerId` | string(64) | 内部 uid |
| `ownerName` | string(64) | 冗余昵称，便于控制台不 join |
| `visibility` | string(16) | `private` / `channel` / `public` |
| `messageCount` | unsigned | 快照条数（含转发展开，不含引用链） |
| `createdAt` | timestamp | 收藏时间 |
| `deletedAt` | timestamp, nullable | 软删除 |
| `degraded` | json | `string[]`，如 `['forward-unavailable']` |
| `meta` | json | `{ guildName?, channelName?, accent? }` |

- unique：`platform + channelId + messageId + ownerId`
- indexes：`ownerId + createdAt`、`channelId + createdAt`、`visibility + createdAt`

### `chatclip_message`（Message Snapshot）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | unsigned, autoInc, primary | |
| `clipId` | unsigned | |
| `seq` | unsigned | 展示顺序 |
| `role` | string(8) | `main` / `quote` / `forward` |
| `quoteDepth` | unsigned | 引用链层号，主消息 0 |
| `parentId` | string(64), nullable | 转发的父 messageId |
| `messageId` | string(64) | 原消息 id，可能为空 |
| `userId` / `username` / `nickname` | string | 发送者三元组 |
| `content` | text | 纯文本，用于搜索 |
| `elements` | json | 序列化后的 `{type, attrs, children}[]` |
| `timestamp` | timestamp | 消息时间；缺失时回落收藏时间 |
| `degraded` | json | 该条自身的降级原因 |

- indexes：`clipId + seq`

### `chatclip_attachment`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | unsigned, autoInc, primary | |
| `clipId` | unsigned | |
| `messageRowId` | unsigned | 归属快照 |
| `type` | string(8) | `img` / `video` / `audio` / `file` |
| `assetsUrl` | text | 转存结果 |
| `originalUrl` | text | 兜底 |
| `filename` / `size` | string / unsigned | |
| `expired` | boolean | 转存失败标记 |

## 3. 采集流程

```
session.message (带 quote)
  ├─ 建 Clip 行（visibility 取参数 → 回落配置默认值）
  ├─ 主消息 → Snapshot(role=main, seq=0)
  ├─ quote 链：while (quote && depth < quoteDepth) → Snapshot(role=quote, seq++, quoteDepth=depth)
  │    · quote 缺 timestamp/user 时用 getMessage 补一次，仍缺失则标 degraded
  ├─ 元素扫描：h.select(elements, 'img,video,audio,file,record')
  │    · 有 src 且有 ctx.assets → assets.upload(src) → Attachment
  │    · 失败或没有 assets → Attachment(expired=true, originalUrl=src)
  ├─ <forward id> → bot.internal.getForwardMsg(id)（鸭子类型探测）
  │    · 成功 → 逐条 Snapshot(role=forward, parentId=id)，超过 forwardLimit 截断并标 truncated
  │    · 失败 → degraded.push('forward-unavailable')，仅保留 <forward id>
  └─ 幂等：唯一键命中 → 返回已有 id 并提示"已收藏"，不新建
```

## 4. 展示

模板选择（Q20 结论）：

- `clip.messages.length === 1` → **Card**（大字卡，含直接引用一块 + 附件）
- `>= 2` → **Bubble**（逐条气泡，转发子消息成组）
- `--text` 或无 puppeteer 或渲染抛错 → **Text View**

渲染调用（必须自定义 callback，见 ADR-0003）：

```ts
const img = await ctx.puppeteer.render(html, async (page, next) => {
  await page.setViewport({ width: config.imageWidth, height: 200, deviceScaleFactor: 2 })
  await page.waitForNetworkIdle()
  return next(await page.$('.card'))
})
await session.send(img)
```

不做渲染结果缓存：原图在收藏时就已进 assets，渲染时按 File 取用（Q22）。

Text View 格式严格对齐 `docs/mockups/text.svg`：环形序号、两条缩进、`↳ 引用` 行、转发子项、分页脚注。

## 5. 指令

主名 `clip`，别名 `收藏` / `chatclip` / `fav`。

| 指令 | 行为 |
| --- | --- |
| `clip` | 收藏当前引用；无引用时提示用法 |
| `clip -m <messageId>` | 收藏指定消息（尽力 `getMessage`）；根命令不能带位置参数，否则子命令会被当成参数 |
| `clip [-s private\|channel\|public] [--card\|--bubble\|--text]` | 参数修饰上面两条 |
| `clip list [page]` | 默认"我的收藏"；`--here` 本群、`--all` 含 public |
| `clip show <id>` | 单条卡/气泡展示 |
| `clip search <kw> [--from <user>] [--since <date>] [--until <date>]` | 关键词 + 发送者 + 时间 |
| `clip rm <id>` | 软删除（仅 Owner 或管理员） |
| `clip export <id> [--json\|--html]` | 返回文件 |

## 6. 控制台页面

`ctx.page({ path: '/chatclip', name: '聊天收藏', icon: 'clipboard' })`，页面自套 `<k-layout>`。

- 表格列：ID、发送者、内容摘要（截 40 字）、条数、可见性、来源、收藏时间、操作
- 筛选：关键词、发送者、时间范围、可见性、来源群
- 详情抽屉：全字段 + 附件预览 + 快照列表（含引用链缩进）
- 操作：查看、软删除、恢复、改可见性、导出 JSON / HTML
- 分页

listener（`ctx.console.addListener`，无 session 参数，`this` 是 Client）：

| 事件 | 入参 | 返回 |
| --- | --- | --- |
| `chatclip/list` | `{keyword?, from?, start?, end?, visibility?, channelId?, page, pageSize}` | `{items, total}` |
| `chatclip/get` | `{id}` | 完整 Clip（含 messages、attachments） |
| `chatclip/remove` / `chatclip/restore` | `{id}` | `true` |
| `chatclip/visibility` | `{id, visibility}` | `true` |
| `chatclip/export` | `{id, format}` | `string` |

前端：`<el-table>` / `<el-pagination>` / `<el-drawer>` / `<el-date-picker>` / `<el-select>` 直接用，**不要 import element-plus**。

## 7. 配置项

```ts
interface Config {
  defaultVisibility: 'private' | 'channel' | 'public'   // private
  quoteDepth: number        // 3   引用链最大层数，0 = 不展开
  forwardDepth: number      // 1   转发展开层数
  forwardLimit: number      // 50  单次展开条数上限
  allowPrivate: boolean     // true
  allowGroup: boolean       // true
  storage: boolean          // true 是否转存到 assets
  maxAssetSize: number      // 10   附件大小上限（MB）
  maxLocalImageSize: number // 5    本地转存图片大小上限（MB），0 = 不限
  textImageLimit: number    // 6    --text 跟发图片张数
  pageSize: number          // 10
  maxClipsPerUser: number   // 0 = 无限
  imageWidth: number        // 720
  fontFamily: string        // 系统中文栈
}
```

## 8. 文件结构

```
src/index.ts        插件入口、Config、inject、启动自检（assets selfUrl）
src/db.ts           三张表定义
src/collect.ts      session → Clip 数据（含 forward/quote 展开、附件转存）
src/render/text.ts  Text View
src/render/html.ts  Card / Bubble 模板（内联 <style>）
src/render/index.ts puppeteer 调用与降级
src/commands.ts     指令
src/console.ts      addListener
client/index.ts     ctx.page 注册
client/page.vue     控制台页面
```

## 9. 验收清单

已用 `scripts/smoke.ts`（采集→落库→幂等→转发→查询→文字→图片）与 `scripts/e2e-console.mjs`（关键词/可见性筛选、JSON 导出）实测：

- [x] 群聊引用一条文字消息 → 单条卡，`#id` 可 `clip show`
- [x] 引用一条带图消息 → 卡里能看到转存后的图（assets 地址，非原 URL）
- [x] 引用一条合并转发 → 气泡卡，子消息逐条展开且顺序正确
- [x] 同一条消息再收藏一次 → 返回同一个 `#id`，库里只有一行
- [x] `clip --text` 输出与 `docs/mockups/text.svg` 一致
- [x] `clip search` 按关键词/发送者/时间三个条件都能过滤
- [x] 控制台列表面板能翻页、能改可见性、能导出 JSON 与 HTML
- [x] 未启用 puppeteer 时降级成文字而不是抛错
- [x] `assets-local` 没配 `selfUrl` 时启动有 warn
- [x] 空正文 + 合并转发时不出现空气泡
- [ ] 真机（NapCat / OneBot v11）引用真实消息 —— 需要用户在 bot 上验证

## 10. 已知风险

- 引用链递归可能成环（A 引用 B、B 引用 A），必须用 `visited` 集合 + 深度上限双保险。
- `getForwardMsg` 返回的是 OneBot 原始段，需要自己写段 → `h` 元素映射，不能复用适配器内部函数。
- 大图（> 10MB）转存会拖慢收藏，需要在 upload 前判断 `size` 并降级。
