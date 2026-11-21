# koishi-plugin-chatclip

[![npm](https://img.shields.io/npm/v/koishi-plugin-chatclip?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-chatclip)

在群聊 / 私聊里**引用一条消息**，把它连同引用链、合并转发、图片一起存进数据库；之后可以用文字列表浏览，也可以用图片渲染成「大字卡」或「聊天气泡」。

- 采集的字段：发送者（昵称 / 用户名 / 平台 ID / 头像）、正文、消息时间、引用消息、合并转发的子消息、附件（图片 / 文件 / 语音）、平台与频道信息、收藏人与可见性。
- 附件在收藏时**转存到 `assets`**，不依赖平台临时链接；转存失败会退化成原 URL 并标记降级原因。
- 同一个人的同一条消息**重复收藏是幂等的**：唯一键 `(platform, channelId, messageId, ownerId)`，重复引用返回同一个 `#A0001` 编号。
- 展示：`clip show` 单条大字卡，`clip list --image` 气泡总览，`clip --text` 纯文字，puppeteer 缺失时自动降级为文字。
- 控制台页面：筛选、翻页、改可见性、软删除 / 恢复、导出 JSON / HTML。

## 安装

```bash
# 在 Koishi 控制台的「插件市场」里搜索 chatclip，或：
npm i koishi-plugin-chatclip
```

依赖：

| 插件 | 作用 | 是否必须 |
| --- | --- | --- |
| `database`（sqlite / mysql / mongo 等） | 存收藏 | 必须 |
| `assets-local` / `assets-s3` | 转存图片 | 强烈建议，缺了图片会退化成原 URL |
| `puppeteer` | 图片渲染 | 可选，缺了自动降级为文字 |
| `console` | 控制台页面 | 可选 |

> `assets-local` 记得配 `selfUrl`（如 `http://localhost:5140`），否则转存后会变成 `file://` 地址，QQ 等平台看不到图。插件启动时会检查并 warn。

## 编号

收藏编号形如 #A0001，硬删除后会自动补位（删掉 3 号，原来的 4 号变成 3 号），聊天里和控制台看到的是同一个编号。

## 指令

| 指令 | 说明 |
| --- | --- |
| `clip`（引用一条消息） | 收藏这条消息，默认按配置的可见性 |
| `clip -s channel` | 这次收藏为「本群可见」（`private` / `channel` / `public`） |
| `clip list [页码]` | 收藏列表（文字） |
| `clip list --image` | 收藏列表（气泡图） |
| `clip list --here` | 只看本群的 |
| `clip list --all` | 只看公开的 |
| `clip list --from <昵称>` | 按发送者筛选 |
| `clip list --since 7d` / `--until 2026-11-01` | 按时间筛选，支持 `7d` `24h` `30m` 与绝对时间 |
| `clip show <编号>` | 渲染单条：大字卡（有合并转发时出气泡） |
| `clip show <编号> --text` / `--card` / `--bubble` | 强制指定展示形态 |
| `clip search <关键词>` | 按正文搜索 |
| `clip rm <编号>` | 软删除自己的收藏 |
| `clip export <编号>` / `--html` | 导出 JSON / HTML |

别名：`收藏`、`chatclip`、`fav`。

## 配置

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `defaultVisibility` | `private` | 默认可见性：`private` 仅自己 / `channel` 本群 / `public` 公开 |
| `quoteDepth` | `3` | 引用链最多向上存几层 |
| `forwardDepth` | `1` | 合并转发展开几层 |
| `forwardLimit` | `50` | 单次展开的子消息上限，超出标记 `truncated` |
| `allowPrivate` / `allowGroup` | `true` | 是否允许私聊 / 群聊收藏 |
| `storage` | `true` | 是否把附件转存到 assets |
| `maxAssetSize` | `10MB` | 超过这个大小的附件不转存，只留原 URL |
| `reaction` / `reactionEmoji` | `false` / `📌` | 是否支持用表情回应收藏 |
| `pageSize` | `10` | 列表每页条数 |
| `maxClipsPerUser` | `0` | 每人收藏上限，0 表示不限制 |
| `imageWidth` | `720` | 渲染图片宽度 |

## 控制台

控制台侧边栏「聊天收藏」页面：关键词 / 发送者 / 可见性 / 时间范围筛选，表格里可以直接改可见性、查看详情抽屉、导出 JSON / HTML、软删除与恢复。

实现使用 `ctx.console.addListener`（实验性 API），事件名为 `chatclip/list|get|remove|restore|visibility|export`。

## 开发

```bash
yarn dev          # 仓库根目录，NODE_ENV=development，控制台前端走 vite 直读源码
yarn build        # 全量构建（tsc → esbuild → client）
```

本目录下还有几个自测脚本（不参与打包）：

```bash
node -r esbuild-register scripts/smoke.ts   # 端到端：采集→落库→幂等→转发→查询→文字→图片
node -r esbuild-register scripts/seed.ts    # 往开发数据库塞几条假收藏
node scripts/shot.mjs http://127.0.0.1:5140/chatclip .preview/console.png
node scripts/e2e-console.mjs                # 控制台筛选与导出的端到端检查
```

设计文档见 `docs/PLAN.md`、`GLOSSARY.md`、`docs/adr/`，设计稿见 `docs/mockups/`（SVG），全部命令的验收流程见 `docs/VERIFY.md`。

> 注意：控制台在 **prod 模式**下会校验静态资源路径必须落在 `node_modules` 或控制台自身目录里。本插件开发时是工作区软链接（`external/chatclip` → `node_modules/koishi-plugin-chatclip`），所以 prod 模式访问 `/chatclip` 会 403，本地调试一律用 `yarn dev`。发布安装后不存在这个问题。

### 已知问题：命令报 `RangeError: Maximum call stack size exceeded`

现象：发送 `clip`、`clip.list` 时抛错，栈里全是 `at Object.fork.parent.filter (@koishijs/loader/src/shared.ts:350)`。

成因在 koishi loader 而不是本插件：loader 应用插件时会安装一层 `$filter` 包装

```ts
fork.parent.filter = (session) => parent.filter(session) && (isNullable(filter) || session.resolve(filter))
```

控制台改插件配置（`@koishijs/plugin-config` 的 `manager/reload`）和 HMR 会以**插件自己的上下文**再次调用 `loader.reload`，某些重载顺序会让这层包装指向自身，于是之后任何一次 `ctx.filter(session)` 都会栈溢出；命令匹配恰好是 `cmd.match() → cmd.ctx.filter(session)`，所以表现为「一发 `clip` 就炸」。

插件里做了兜底：`protectFilter()` 在 apply 时、下一个 tick、以及 `ready` 时各探测一次本插件的 `ctx.filter`，一旦发现栈溢出就把本插件上下文回退成 `filter = () => true` 并打 warn。这样 `clip` 系列命令不再受影响（本插件没有用到 `$filter`）。

**根治办法**：重启一次 koishi，重载期间留下的自引用链就没了。如果重启后仍然复现，请把 `Error.stackTraceLimit = 300` 打开后再发一次 `clip`，把完整栈贴出来——重点看最深处的调用者是不是 `middleware.ts` 的 `_executeMatcher`（若如此，说明环在别的插件上，本插件的兜底无能为力）。

## 许可

MIT
