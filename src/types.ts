/**
 * 这些包只提供类型增强（Context.assets / Context.puppeteer / Context.console），
 * 运行时由用户的 koishi 实例按需安装，这里只 import type 不引入实际依赖。
 */
import type {} from '@koishijs/assets'
import type {} from '@koishijs/console'
import type {} from 'koishi-plugin-puppeteer'
