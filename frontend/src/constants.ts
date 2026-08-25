import type { PoiCategory } from './api/agent'

export const CAT_ICON: Record<PoiCategory, string> = {
  bookstore: '📚', cafe: '☕', sight: '🏛', museum: '🎨',
  mall: '🛍', park: '🌳', restaurant: '🍜',
  shop: '◇', market: '▦', studio: '✦', street_scene: '⌁', event: '◉',
}

export const CAT_LABEL: Record<PoiCategory, string> = {
  bookstore: '书店', cafe: '咖啡', sight: '景点', museum: '博物馆',
  mall: '商场', park: '公园', restaurant: '餐厅',
  shop: '特色小店', market: '市场市集', studio: '工作室', street_scene: '城市空间', event: '活动',
}
