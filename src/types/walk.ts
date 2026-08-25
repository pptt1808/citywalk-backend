import { PlanningResult } from "./plan";

export type WalkAdjustmentReason =
  | "tired"
  | "time_short"
  | "rain"
  | "crowded"
  | "rest"
  | "restroom"
  | "custom"
  | "deviation";

export interface WalkGeoPoint {
  lng: number;
  lat: number;
  accuracy?: number;
}

export interface WalkAdjustmentRequest {
  route: PlanningResult;
  reason: WalkAdjustmentReason;
  visitedStopNames: string[];
  skippedStopNames?: string[];
  currentLocation?: WalkGeoPoint;
  remainingMinutes?: number;
  customRequest?: string;
}

export interface WalkRouteRevision {
  id: string;
  reason: WalkAdjustmentReason;
  reasonLabel: string;
  summary: string;
  adjustedAt: string;
  completedStopNames: string[];
  retainedStopNames: string[];
  removedStopNames: string[];
  addedStopNames: string[];
  remainingMinutes: number;
  warnings: string[];
}

export interface WalkAdjustmentResponse {
  route: PlanningResult;
  revision: WalkRouteRevision;
}
