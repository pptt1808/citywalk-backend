import { Router } from "express";
import { createSkillHandler, deleteSkillHandler, listSkillsHandler, updateSkillHandler } from "../controllers/skillController";
import { asyncHandler } from "../middleware/http";

export const skillsRouter = Router();

skillsRouter.get("/", asyncHandler(listSkillsHandler));
skillsRouter.post("/", asyncHandler(createSkillHandler));
skillsRouter.patch("/:id", asyncHandler(updateSkillHandler));
skillsRouter.delete("/:id", asyncHandler(deleteSkillHandler));
