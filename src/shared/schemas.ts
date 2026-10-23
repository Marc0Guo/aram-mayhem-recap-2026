import { z } from 'zod'
import { isValidTimeZone } from './time'

export const entityFilterSchema = z.object({
  championId: z.number().int().nullable(),
  augmentId: z.string().min(1).max(120).nullable(),
  itemId: z.number().int().nullable()
})

export const rangeSchema = z.object({
  accountId: z.string().min(4).max(80),
  preset: z.enum(['last7', 'last30', 'lastWeek', 'thisYear', 'all', 'custom']),
  customStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  customEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  timeZone: z.string().min(1).max(80).refine(isValidTimeZone),
  locale: z.enum(['zh-CN', 'en']),
  championId: z.number().int().nullable(),
  augmentId: z.string().min(1).max(120).nullable(),
  itemId: z.number().int().nullable()
})

export const listSchema = rangeSchema.extend({
  cursor: z.string().max(200).nullable()
})

export const detailSchema = z.object({
  accountId: z.string().min(4).max(80),
  platformId: z.string().min(1).max(32),
  gameId: z.string().min(1).max(64),
  locale: z.enum(['zh-CN', 'en']),
  timeZone: z.string().min(1).max(80).refine(isValidTimeZone)
})

export const syncStartSchema = z.object({
  accountId: z.string().min(4).max(80),
  kind: z.enum(['launch', 'manual', 'continue', 'rebuild'])
})

export const syncCancelSchema = z.object({
  runId: z.string().min(4).max(80)
})

export const exportSchema = rangeSchema.extend({
  title: z.string().min(1).max(80),
  includeAlias: z.boolean()
})

export const settingsSchema = z.object({
  locale: z.enum(['zh-CN', 'en']),
  timeZone: z.string().min(1).max(80).refine(isValidTimeZone),
  offline: z.boolean(),
  imageDownloads: z.enum(['auto', 'never']),
  leagueDir: z.string().max(260).nullable()
})

export const iconsSchema = z.object({
  profileIconIds: z.array(z.number().int().min(0).max(999999)).max(24).optional(),
  locale: z.enum(['zh-CN', 'en']),
  championIds: z.array(z.number().int().min(1).max(9999)).max(200),
  itemIds: z.array(z.number().int().min(1).max(9999999)).max(400),
  augmentIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)).max(400)
})

export const deleteAccountSchema = z.object({
  accountId: z.string().min(4).max(80),
  confirmed: z.literal(true)
})

export type RangeInput = z.infer<typeof rangeSchema>
export type ListInput = z.infer<typeof listSchema>
export type ExportInput = z.infer<typeof exportSchema>
export type SettingsInput = z.infer<typeof settingsSchema>
