import { Request, Response } from "express";
import { MapTool } from "../tools/mapTool";

const mapTool = new MapTool();

export async function geocodeHandler(req: Request, res: Response) {
  const address = String(req.query.address ?? "");
  const city = String(req.query.city ?? "南京");
  if (!address.trim()) {
    return res.status(400).json({ message: "缺少 address 参数" });
  }
  const location = await mapTool.geocode(address.trim(), city);
  return res.status(200).json({ location });
}

export async function poiSearchHandler(req: Request, res: Response) {
  const keywords = String(req.query.keywords ?? "书店,咖啡,博物馆")
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const city = String(req.query.city ?? "南京");
  const location = firstQuery(req.query.location);
  const radius = Number(req.query.radius) || undefined;
  const indoorOnly = req.query.indoorOnly === "true";
  const page = Number(req.query.page) || 1;
  const offset = Math.min(Number(req.query.offset) || 10, 25);

  const pois = location
    ? await mapTool.searchNearbyPoi(keywords, { city, location, radius, indoorOnly, page, offset })
    : await mapTool.searchPoi(keywords, { city, indoorOnly, page, offset });

  return res.status(200).json({ pois });
}

export async function routeHandler(req: Request, res: Response) {
  const origin = String(req.query.origin ?? "");
  const destination = String(req.query.destination ?? "");
  const mode = String(req.query.mode || "walk") as "walk" | "transit" | "bicycling";
  const city = String(req.query.city ?? "南京");

  if (!origin.trim() || !destination.trim()) {
    return res.status(400).json({ message: "缺少 origin 或 destination 参数" });
  }

  let leg;
  if (mode === "bicycling") {
    leg = await mapTool.planBicyclingRoute(origin.trim(), destination.trim());
  } else {
    const legs = await mapTool.planRoute(origin.trim(), [destination.trim()], mode, city);
    leg = legs[0];
  }

  return res.status(200).json({ route: leg });
}

export async function distanceMatrixHandler(req: Request, res: Response) {
  const origins = String(req.query.origins ?? "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const destination = String(req.query.destination ?? "");
  const type = (String(req.query.type || "walk") as "walk" | "bicycling");

  if (origins.length === 0 || !destination.trim()) {
    return res.status(400).json({ message: "缺少 origins 或 destination 参数" });
  }

  const items = await mapTool.distanceMatrix(origins, destination.trim(), type);
  return res.status(200).json({ distances: items });
}

export async function multiRouteHandler(req: Request, res: Response) {
  const origin = String(req.query.origin ?? "");
  const destinationsRaw = String(req.query.destinations ?? "");
  const mode = String(req.query.mode || "walk") as "walk" | "transit" | "mixed";
  const city = String(req.query.city ?? "南京");

  if (!origin.trim() || !destinationsRaw.trim()) {
    return res.status(400).json({ message: "缺少 origin 或 destinations 参数" });
  }

  const destinations = destinationsRaw
    .split(/[|,，]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const legs = await mapTool.planRoute(origin.trim(), destinations, mode, city);
  return res.status(200).json({ legs });
}

export async function cityCenterHandler(req: Request, res: Response) {
  const city = String(req.query.city ?? "南京");
  const location = await mapTool.geocode(city, city);
  return res.status(200).json({ city, center: location });
}

function firstQuery(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" ? v : undefined;
}
