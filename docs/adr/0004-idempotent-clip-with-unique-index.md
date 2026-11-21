# ADR-0004：幂等 + 一次性建好唯一索引

**状态**：已接受（2026-11-20）

## 背景

同一个人对同一条消息重复触发收藏（手滑、重复回复、reaction 连点）应当是幂等的。minato 的 `unique` 约束在表创建后**不会再补建**，而 `ctx.model.migrate()` 会把未声明字段标 deprecated 从而不建列 —— 表结构必须一次设计到位。

## 决策

- 唯一键：`(platform, channelId, messageId, ownerId)`。带 `ownerId` 是因为同一平台消息被不同人收藏必须允许；
- 命中唯一键时返回已有 Clip 并提示"已收藏 #id"，不新建；
- 所有字段、所有索引在首版 `ctx.model.extend` 里一次性声明完整。

## 后果

- 重复收藏零成本，控制台不会出现重复行；
- 未来若要允许"同一消息多条副本"，必须新增一列并在唯一键里加进去 —— 那时无法原地加 unique，需要新建表迁移；
- 平台不提供 messageId（例如某些适配器的 Quote 没有 id）时，退化为 `(platform, channelId, hash(content), timestamp, ownerId)` 的合成键。
