import { z } from "zod";

export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

/** @param {import('zod').ZodTypeAny} itemSchema */
export function paginatedListSchema(itemSchema) {
  return z.object({
    items: z.array(itemSchema),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  });
}

/** @param {import('zod').ZodTypeAny} dataSchema */
export function apiSuccessSchema(dataSchema) {
  return z.object({
    success: z.literal(true),
    message: z.string(),
    data: dataSchema,
    code: z.string().optional(),
  });
}

export const apiErrorSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
  field: z.string().optional(),
});
