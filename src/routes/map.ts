import { Router } from "express";
import {
  geocodeHandler,
  poiSearchHandler,
  routeHandler,
  distanceMatrixHandler,
  multiRouteHandler,
  cityCenterHandler
} from "../controllers/mapController";
import { asyncHandler } from "../middleware/http";

export const mapRouter = Router();

// GET /api/map/geocode?address=新街口&city=南京
mapRouter.get("/geocode", asyncHandler(geocodeHandler));

// GET /api/map/poi?city=南京&keywords=咖啡,书店&location=116.4,39.9&radius=2000&indoorOnly=true
mapRouter.get("/poi", asyncHandler(poiSearchHandler));

// GET /api/map/route?origin=116.4,39.9&destination=116.41,39.91&mode=walk&city=南京
mapRouter.get("/route", asyncHandler(routeHandler));

// GET /api/map/distance?origins=116.4,39.9|116.5,39.9&destination=116.41,39.91&type=walk
mapRouter.get("/distance", asyncHandler(distanceMatrixHandler));

// GET /api/map/multi-route?origin=116.4,39.9&destinations=116.41,39.91|116.42,39.92&mode=walk&city=南京
mapRouter.get("/multi-route", asyncHandler(multiRouteHandler));

// GET /api/map/city-center?city=南京
mapRouter.get("/city-center", asyncHandler(cityCenterHandler));
