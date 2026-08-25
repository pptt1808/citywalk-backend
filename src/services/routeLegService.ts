import { RouteLeg } from "../types/plan";

type Coordinate = readonly [longitude: number, latitude: number];

const SAME_PLACE_THRESHOLD_METERS = 30;
const LOCATION_MATCH_THRESHOLD_METERS = 5;
const ROUTE_DISTANCE_FACTOR = 1.15;
const WALKING_METERS_PER_MINUTE = 75;

function parseCoordinate(value: string | undefined): Coordinate | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [longitude, latitude] = parts;
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return undefined;
  return [longitude, latitude];
}

function haversineMeters(left: Coordinate, right: Coordinate): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusMeters = 6_371_000;
  const deltaLatitude = radians(right[1] - left[1]);
  const deltaLongitude = radians(right[0] - left[0]);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(left[1])) * Math.cos(radians(right[1])) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function locationsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const leftCoordinate = parseCoordinate(left);
  const rightCoordinate = parseCoordinate(right);
  return Boolean(leftCoordinate && rightCoordinate
    && haversineMeters(leftCoordinate, rightCoordinate) <= LOCATION_MATCH_THRESHOLD_METERS);
}

/** A provider route is usable only when it contains actual positive path metrics. */
export function isUsableRouteLeg(leg: RouteLeg | undefined): leg is RouteLeg {
  if (!leg || !Number.isFinite(leg.distanceMeters) || !Number.isFinite(leg.durationMinutes)) return false;
  if (leg.samePlaceTransfer) return leg.distanceMeters >= 0 && leg.durationMinutes >= 0;
  return leg.distanceMeters > 0 && leg.durationMinutes > 0;
}

function estimateMissingLeg(origin: string, destination: string): RouteLeg | undefined {
  const originCoordinate = parseCoordinate(origin);
  const destinationCoordinate = parseCoordinate(destination);
  if (!originCoordinate || !destinationCoordinate) return undefined;

  const directDistance = haversineMeters(originCoordinate, destinationCoordinate);
  if (directDistance <= SAME_PLACE_THRESHOLD_METERS) {
    const roundedDistance = Math.round(directDistance);
    return {
      origin,
      destination,
      distanceMeters: roundedDistance,
      durationMinutes: roundedDistance === 0 ? 0 : 1,
      mode: "walk",
      estimated: true,
      samePlaceTransfer: true,
      fallbackReason: "两点位于同一场馆或相邻入口，按场馆内移动处理"
    };
  }

  // A road route is usually longer than a straight line. This remains an
  // explicitly disclosed estimate and is never presented as provider data.
  const estimatedDistance = Math.max(1, Math.round(directDistance * ROUTE_DISTANCE_FACTOR));
  return {
    origin,
    destination,
    distanceMeters: estimatedDistance,
    durationMinutes: Math.max(1, Math.ceil(estimatedDistance / WALKING_METERS_PER_MINUTE)),
    mode: "walk",
    estimated: true,
    fallbackReason: "路径服务未返回该段，按坐标距离估算，请以实时导航为准"
  };
}

/**
 * Reconcile provider results against every expected stop pair. A partial API
 * response must not leave bogus 0m/1min legs in an otherwise valid route.
 */
export function completeRouteLegs(
  origin: string,
  destinations: string[],
  providerLegs: RouteLeg[]
): RouteLeg[] {
  const expectedPairs = destinations.map((destination, index) => ({
    origin: index === 0 ? origin : destinations[index - 1],
    destination
  }));
  const usedProviderIndexes = new Set<number>();

  return expectedPairs.flatMap((pair, pairIndex) => {
    let providerIndex = providerLegs.findIndex((leg, index) => !usedProviderIndexes.has(index)
      && locationsMatch(leg.origin, pair.origin)
      && locationsMatch(leg.destination, pair.destination));

    // Keep compatibility with tools that preserve order but normalize only
    // one endpoint string differently.
    if (providerIndex < 0 && providerLegs[pairIndex]
      && !usedProviderIndexes.has(pairIndex)
      && locationsMatch(providerLegs[pairIndex].destination, pair.destination)) {
      providerIndex = pairIndex;
    }

    if (providerIndex >= 0) {
      usedProviderIndexes.add(providerIndex);
      const providerLeg = providerLegs[providerIndex];
      if (isUsableRouteLeg(providerLeg)) return [providerLeg];
    }

    const estimate = estimateMissingLeg(pair.origin, pair.destination);
    return estimate ? [estimate] : [];
  });
}
