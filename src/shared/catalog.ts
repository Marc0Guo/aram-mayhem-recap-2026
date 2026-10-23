import type { Locale } from './types'

const CHAMPIONS: Record<number, { en: string; zh: string }> = {
  51: { en: 'Caitlyn', zh: '凯特琳' },
  81: { en: 'Ezreal', zh: '伊泽瑞尔' },
  157: { en: 'Yasuo', zh: '亚索' },
  222: { en: 'Jinx', zh: '金克丝' }
}

const ITEMS: Record<number, { en: string; zh: string }> = {
  1001: { en: 'Boots (demo)', zh: '鞋子（演示）' },
  3006: { en: "Berserker's (demo)", zh: '攻速鞋（演示）' },
  3031: { en: 'Infinity Edge (demo)', zh: '无尽之刃（演示）' },
  3072: { en: 'Bloodthirster (demo)', zh: '饮血剑（演示）' },
  3094: { en: 'Rapid Firecannon (demo)', zh: '疾射火炮（演示）' }
}

const AUGMENTS: Record<string, { en: string; zh: string }> = {
  'aug-prism': { en: 'Prism (demo)', zh: '棱镜（演示）' },
  'aug-blade': { en: 'Blade (demo)', zh: '锋刃（演示）' },
  'aug-shield': { en: 'Shield (demo)', zh: '护盾（演示）' },
  'aug-tempo': { en: 'Tempo (demo)', zh: '节奏（演示）' }
}

function lang(locale: Locale): 'en' | 'zh' {
  return locale === 'zh-CN' ? 'zh' : 'en'
}

export function championName(id: number | null, locale: Locale, mode: 'demo' | 'real'): string {
  if (id == null) return locale === 'zh-CN' ? '未知英雄' : 'Unknown champion'
  if (mode === 'demo' && CHAMPIONS[id]) return CHAMPIONS[id][lang(locale)]
  return `#${id}`
}

export function itemName(id: number, locale: Locale, mode: 'demo' | 'real'): string {
  if (id === 0) return locale === 'zh-CN' ? '空' : 'Empty'
  if (mode === 'demo' && ITEMS[id]) return ITEMS[id][lang(locale)]
  return `#${id}`
}

export function augmentName(id: string, locale: Locale, mode: 'demo' | 'real'): string {
  if (mode === 'demo' && AUGMENTS[id]) return AUGMENTS[id][lang(locale)]
  return id
}
