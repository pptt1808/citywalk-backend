import { Request, Response } from "express";
import { z } from "zod";
import { journalLayoutService } from "../services/journalLayoutService";
import { authUserId } from "../middleware/auth";
import { journalAssetStore } from "../services/journalAssetStore";
import { JournalIllustrationError, journalIllustrationService } from "../services/journalIllustrationService";
import {
  JOURNAL_LAYOUT_RECIPES,
  JOURNAL_ILLUSTRATION_MODES,
  JOURNAL_PHOTO_TREATMENTS,
  JOURNAL_TAPE_POSITIONS,
  JOURNAL_TEXT_PLACEMENTS
} from "../types/journal";

const PlacementSchema = z.object({
  blockId: z.string().trim().min(1).max(128),
  page: z.enum(["left", "right"]),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  rotation: z.number().finite(),
  zIndex: z.number().finite(),
  textPlacement: z.enum(JOURNAL_TEXT_PLACEMENTS),
  photoTreatment: z.enum(JOURNAL_PHOTO_TREATMENTS),
  tapePosition: z.enum(JOURNAL_TAPE_POSITIONS)
});

const LayoutRequestSchema = z.object({
  title: z.string().trim().max(160).default(""),
  city: z.string().trim().max(80).optional(),
  note: z.string().trim().max(3000).optional(),
  routeStops: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  currentRecipes: z.array(z.enum(JOURNAL_LAYOUT_RECIPES)).max(30).optional(),
  currentPlacements: z.array(PlacementSchema).max(60).optional(),
  images: z.array(z.object({
    blockId: z.string().trim().min(1).max(128),
    imageUrl: z.string().max(800_000).regex(/^data:image\/(?:jpeg|jpg|png|webp);base64,[a-zA-Z0-9+/=]+$/u)
  })).max(8).optional(),
  blocks: z.array(z.object({
    id: z.string().trim().min(1).max(128),
    kind: z.enum(["photo-text", "text"]),
    renderMode: z.enum(["original-photo", "cutout-illustration", "gathered-collage"]).optional(),
    title: z.string().trim().max(160).default(""),
    text: z.string().trim().max(2000).default(""),
    placeName: z.string().trim().max(120).optional(),
    aspectRatio: z.number().positive().max(20).optional(),
    orientation: z.enum(["portrait", "landscape", "square"]).optional()
  })).min(1).max(60)
});

const IllustrationRequestSchema = z.object({
  sourceImage: z.string().max(11_000_000).regex(/^data:image\/(?:jpeg|jpg|png|webp);base64,[a-zA-Z0-9+/=]+$/u),
  blockId: z.string().trim().min(1).max(128),
  photoId: z.string().trim().min(1).max(128),
  mode: z.enum(JOURNAL_ILLUSTRATION_MODES).default("distilled-contour"),
  title: z.string().trim().max(160).optional(),
  text: z.string().trim().max(2000).optional(),
  placeName: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  styleDescription: z.string().trim().max(300).optional()
});

export async function generateJournalLayoutHandler(req: Request, res: Response) {
  const parsed = LayoutRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "手账排版素材格式不正确", issues: parsed.error.flatten() });
  }
  const result = await journalLayoutService.generate(parsed.data);
  return res.status(200).json(result);
}

export async function generateJournalIllustrationHandler(req: Request, res: Response) {
  const parsed = IllustrationRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "手账插画素材格式不正确", issues: parsed.error.flatten() });
  }
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Client disconnected"));
  req.once("aborted", abort);
  try {
    const result = await journalIllustrationService.generate(authUserId(req), parsed.data, controller.signal);
    return res.status(200).json({
      assetId: result.asset.id,
      imageUrl: `/api/journal/illustrations/${encodeURIComponent(result.asset.id)}`,
      provider: "volcengine-ark",
      model: result.asset.model,
      prompt: result.asset.prompt,
      styleDescription: result.asset.styleDescription,
      mode: result.mode,
      workflow: result.workflow,
      generatedAt: result.asset.createdAt,
      cached: result.cached
    });
  } catch (error) {
    if (!(error instanceof JournalIllustrationError)) throw error;
    const status = error.code === "NOT_CONFIGURED"
      ? 503
      : error.code === "INVALID_SOURCE"
        ? 400
        : error.code === "QUOTA_EXCEEDED" || error.code === "BUSY"
          ? 429
          : 502;
    return res.status(status).json({ code: error.code, message: error.message });
  } finally {
    req.removeListener("aborted", abort);
  }
}

export async function getJournalIllustrationHandler(req: Request, res: Response) {
  const id = String(req.params.id ?? "");
  if (!/^ill_[0-9a-f-]{36}$/iu.test(id)) return res.status(404).json({ message: "插画不存在" });
  const asset = journalAssetStore.getById(authUserId(req), id);
  if (!asset) return res.status(404).json({ message: "插画不存在" });
  if (asset.mimeType !== "image/png") {
    const bytes = await journalIllustrationService.transparentBytes(asset);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");
    return res.send(bytes);
  }
  res.setHeader("Content-Type", asset.mimeType);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("Content-Disposition", `inline; filename="${asset.id}"`);
  return res.sendFile(asset.filePath);
}

export async function deleteJournalIllustrationHandler(req: Request, res: Response) {
  const id = String(req.params.id ?? "");
  if (!/^ill_[0-9a-f-]{36}$/iu.test(id)) return res.status(404).json({ message: "插画不存在" });
  const deleted = journalAssetStore.delete(authUserId(req), id);
  return deleted ? res.status(204).send() : res.status(404).json({ message: "插画不存在" });
}
