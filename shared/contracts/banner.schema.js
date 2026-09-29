import { z } from "zod";

export const createBannerSchema = z.object({
  mediaUrl: z.string().refine(val => {
    return z.string().url().safeParse(val).success || z.string().uuid().safeParse(val).success;
  }, { message: "Banner media URL must be a valid URL or a valid MediaAsset UUID" }),
  linkUrl: z.string().url("Banner link URL must be a valid URL").optional().nullable(),
  text: z.string().max(200).optional().nullable(),
  targetCategoryId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(false), // NOT auto-published per §5.4
});
