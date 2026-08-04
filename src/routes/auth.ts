import { Router } from "express";
import { asyncHandler } from "../middleware/http";
import { optionalAuth, requireAuth } from "../middleware/auth";
import { loginHandler, logoutHandler, meHandler, registerHandler } from "../controllers/authController";

export const authRouter = Router();
authRouter.post("/register", asyncHandler(registerHandler));
authRouter.post("/login", asyncHandler(loginHandler));
authRouter.get("/me", optionalAuth, meHandler);
authRouter.post("/logout", requireAuth, logoutHandler);

