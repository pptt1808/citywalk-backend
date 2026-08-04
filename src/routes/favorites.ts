import { Router } from "express";
import { asyncHandler } from "../middleware/http";
import { addFavoriteRouteHandler, deleteFavoriteRouteHandler, listFavoriteRoutesHandler } from "../controllers/favoriteController";

export const favoritesRouter = Router();

favoritesRouter.get("/", asyncHandler(listFavoriteRoutesHandler));
favoritesRouter.post("/", asyncHandler(addFavoriteRouteHandler));
favoritesRouter.delete("/:id", asyncHandler(deleteFavoriteRouteHandler));
