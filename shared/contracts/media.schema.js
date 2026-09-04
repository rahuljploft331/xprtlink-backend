import { z } from "zod";

export const mediaAssetDtoSchema = z.object({
  id: z.string().uuid(),
  purpose: z.enum([
    "avatar",
    "quote_attachment",
    "chat_attachment",
    "verification_doc",
    "banner",
  ]),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: z.enum(["pending_upload", "ready", "deleted"]),
  uploadUrl: z.string().url().optional(),
  url: z.string().url().nullable(),
  createdAt: z.string().datetime(),
});

export const createUploadRequestSchema = z.object({
  purpose: z.enum([
    "avatar",
    "quote_attachment",
    "chat_attachment",
    "verification_doc",
    "banner",
  ]),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  fileName: z.string().optional(),
});

export const appConfigDtoSchema = z.object({
  minAppVersion: z.string(),
  forceUpdate: z.boolean(),
  maintenanceMode: z.boolean(),
  maintenanceMessage: z.string().nullable(),
});

export const categoryDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
});

export const cmsPageDtoSchema = z.object({
  slug: z.string(),
  title: z.string(),
  bodyHtml: z.string(),
  publishedAt: z.string().datetime().nullable(),
});
