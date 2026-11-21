import { Schema } from 'koishi'

export interface Config {
  /** 默认可见性，成员可用 -s 覆盖 */
  defaultVisibility: 'private' | 'channel' | 'public'
  /** 引用链最大层数，0 = 不采集引用 */
  quoteDepth: number
  /** 合并转发展开层数，0 = 不展开 */
  forwardDepth: number
  /** 单次展开的转发条数上限 */
  forwardLimit: number
  allowPrivate: boolean
  allowGroup: boolean
  /** 是否把图片/文件转存到 assets */
  storage: boolean
  /** 单个附件大小上限（MB），超过则只留原链接 */
  maxAssetSize: number
  /** clip show --text 时最多跟发几张图片，0 = 不跟发 */
  textImageLimit: number
  pageSize: number
  /** 每人收藏上限，0 = 不限 */
  maxClipsPerUser: number
  /** 渲染画布宽度 */
  imageWidth: number
}

export const Config: Schema<Config> = Schema.object({
  defaultVisibility: Schema.union([
    Schema.const('private').description('仅自己'),
    Schema.const('channel').description('本群可见'),
    Schema.const('public').description('公开'),
  ]).default('private').description('收藏的默认可见性。'),
  quoteDepth: Schema.natural().max(5).default(3).description('引用链最多采集几层。'),
  forwardDepth: Schema.natural().max(2).default(1).description('合并转发展开几层。'),
  forwardLimit: Schema.natural().min(1).max(200).default(50).description('单次展开的转发条数上限。'),
  allowPrivate: Schema.boolean().default(true).description('允许在私聊中使用。'),
  allowGroup: Schema.boolean().default(true).description('允许在群聊中使用。'),
  storage: Schema.boolean().default(true).description('把图片转存到 assets；关闭则只保存原链接。'),
  maxAssetSize: Schema.natural().min(1).default(10).description('单个附件大小上限（MB）。'),
  textImageLimit: Schema.natural().min(0).max(20).default(6).description('clip show --text 时最多一起发送几张图片，0 表示不发送。'),
  pageSize: Schema.natural().min(1).max(50).default(10).description('列表每页条数。'),
  maxClipsPerUser: Schema.natural().default(0).description('每人收藏上限，0 表示不限。'),
  imageWidth: Schema.natural().min(320).max(1600).default(720).description('图片渲染宽度。'),
})
