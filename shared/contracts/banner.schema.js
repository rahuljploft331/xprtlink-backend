import { z } from "zod";

export const createBannerSchema = z.object({
  mediaUrl: z.string().url("Banner media URL must be a valid URL"),
  linkUrl: z.string().url("Banner link URL must be a valid URL").optional().nullable(),
  text: z.string().max(200).optional().nullable(),
  targetCategoryId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(false), // NOT auto-published per §5.4
});
