# GLOSSARY — chatclip

本文件只收录**在本项目里有特定含义**的词。改动术语时同步改这里，并在 `docs/adr/` 留决策记录。

## 领域对象

**Clip（收藏）**
一次收藏动作产生的聚合根。包含 1..n 条 Message Snapshot、可选 Quote Chain、可见性、附件与降级原因。用户口中的"收藏""聊天记录收藏"都指它。不叫"记录""条目"。**没有标签**（2026-11-20 决定）。
· 例：`/clip` 回复一条消息后产生的 `#A1024`。

**Message Snapshot（消息快照）**
被保存的那条消息的**不可变副本**：发送者、内容、时间、附件、原始 messageId。快照一旦写入就不随原消息的编辑/撤回而变（见 ADR-0001）。
· 不叫 "message" —— "message" 专指平台侧的原始消息。

**Quote Chain（引用链）**
主消息的 `quote` 递归展开得到的祖先消息序列，深度上限 `quoteDepth`（默认 3）。**不计入 Clip 条数**，在展示时作为附属块出现。
· 例：B 引用了 A，收藏 B 时 A 也进 Quote Chain。

**Forward Bundle（合并转发）**
一条 `<forward id>` 消息经 `getForwardMsg` 展开出的子消息列表。展开后**计入 Clip 条数**，条数上限 `forwardLimit`（默认 50），超出部分标 `truncated`。
· 不叫 "合并消息""聊天记录卡片"。

**Attachment（附件）**
从消息元素里抽出并转存到 `ctx.assets` 的媒体文件，带 `originalUrl` 兜底与 `expired` 标记。转存失败时 Attachment 仍存在，只是 `expired: true`。

**Visibility（可见性）**
`private`（仅 Owner）/ `channel`（本群成员）/ `public`（全实例，需显式搜索）。默认值由插件配置 `defaultVisibility` 决定，成员可用参数覆盖。

**Owner**
发起收藏的用户（内部 `uid`，不是平台 `userId`）。同一平台消息被不同 Owner 收藏会得到不同的 Clip。

**Degraded（降级）**
采集不完整时的记录：`no-getMessage`、`forward-unavailable`、`asset-upload-failed`、`quote-too-deep` 等。有 Degraded 的 Clip 仍可展示，只是对应块显示占位。

## 展示形态

**Card（单条卡）**
Clip 只含 1 条消息时的图片样式：左侧圆头像 + 引号 + 大字正文 + 署名 + 引用块 + 附件。参考 `docs/mockups/single-card.svg`。

**Bubble（气泡）**
Clip 含 ≥2 条消息时的图片样式：逐条气泡，带头像、昵称、时间，引用内嵌灰块。参考 `docs/mockups/bubble.svg`。

**Text View（文字视图）**
不经过 puppeteer 的纯文本展示，`/clip --text` 与无 puppeteer 时的默认。参考 `docs/mockups/text.svg`。

## 易混淆

- 「条数」永远指 Message Snapshot 的数量（含展开的 Forward Bundle），**不含** Quote Chain。
- 「收藏时间」是 Clip 的 `createdAt`；「消息时间」是快照里各条消息的 `timestamp`。筛选默认按消息时间。
