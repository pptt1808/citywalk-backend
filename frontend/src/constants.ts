import type { PoiCategory } from './api/agent'

export const CAT_ICON: Record<PoiCategory, string> = {
  bookstore: '📚', cafe: '☕', sight: '🏛', museum: '🎨',
  mall: '🛍', park: '🌳', restaurant: '🍜',
}

export const CAT_LABEL: Record<PoiCategory, string> = {
  bookstore: '书店', cafe: '咖啡', sight: '景点', museum: '博物馆',
  mall: '商场', park: '公园', restaurant: '餐厅',
}
