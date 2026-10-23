import type { Locale } from './types'
export function anonymousName(value: string, locale: Locale): string { return value.trim().slice(0,32) || (locale==='zh-CN'?'召唤师':'Summoner') }
export function friendName(real: string, enabled: boolean, name: string): string { return enabled ? `${name}'s friends` : real }
