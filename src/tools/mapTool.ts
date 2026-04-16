export interface Poi {
  name: string;
  category: "bookstore" | "cafe" | "sight";
  averageCost: number;
}

export class MapTool {
  async searchNearbyPoi(keywords: string[]): Promise<Poi[]> {
    // TODO: 接入高德/百度 POI API，这里先用 mock 数据占位
    const candidates: Poi[] = [
      { name: "先锋书店", category: "bookstore", averageCost: 30 },
      { name: "北岸咖啡", category: "cafe", averageCost: 25 },
      { name: "颐和路街区", category: "sight", averageCost: 0 }
    ];

    return candidates.filter((item) =>
      keywords.some((keyword) => item.name.includes(keyword))
    );
  }
}
