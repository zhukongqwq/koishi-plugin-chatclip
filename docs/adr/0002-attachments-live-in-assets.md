# ADR-0002：附件转存到 ctx.assets，而不是存 URL

**状态**：已接受（2026-11-20）

## 背景

QQ/NapCat 给的图片 URL 带时效签名，几小时后失效；直接存 URL 等于存了一个注定会烂的链接。另一方面，本项目要"支持本地存储和 S3 等各种存储"（用户要求），如果自己实现上传，就得为每种存储写一份适配。

## 决策

- 附件统一走 `ctx.assets.upload(url, file)`，存储介质由用户安装的 assets 插件（`assets-local` / `assets-s3` / …）决定，本插件不感知；
- 每条 Attachment 同时保存 `assetsUrl`（转存结果）与 `originalUrl`（兜底）；
- 转存失败不阻断收藏：Attachment 保留 `originalUrl` 并标 `expired: true`，Clip 标 `Degraded: asset-upload-failed`；
- 渲染时优先 `assetsUrl`，失败回落 `originalUrl`，再失败显示占位块。

## 后果

- 换存储后端不需要改本插件；
- 需要 `ctx.assets` 存在才完整工作，因此 `ctx.inject(['assets'])` 并给出可读的降级提示；
- 存储占用翻倍（原图 + 转存），靠 assets 的 `selfUrl` 保证外链可访问；
- 若 `assets-local` 未配置 `selfUrl`，转存结果是 `file://`，QQ 端看不到图 —— 启动时检测并 warn。
