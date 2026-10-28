// Non-equipment ARAM treats. Keep raw stored match inventories unchanged.
// 220013 is the 2026 disco-ball Poro-Snax variant; 2052 is the original treat.
const NON_EQUIPMENT_ITEMS = new Set([0, 2052, 220013])
export function isFinalEquipmentItem(itemId: number): boolean {
  return Number.isSafeInteger(itemId) && itemId > 0 && !NON_EQUIPMENT_ITEMS.has(itemId)
}
