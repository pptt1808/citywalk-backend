export interface UserConstraints {
  city: string;
  startPoint: string;
  durationMinutes: number;
  budget: number;
  preferences: string[];
  weatherRisk?: "low" | "medium" | "high";
}

export interface RouteStop {
  name: string;
  category: "bookstore" | "cafe" | "sight";
  estimatedCost: number;
  estimatedStayMinutes: number;
  reason: string;
}

export interface PlanningResult {
  summary: string;
  totalEstimatedCost: number;
  totalEstimatedMinutes: number;
  stops: RouteStop[];
  decisionLog: string[];
}
