import { getDb } from "@xprtlink/shared/db/index.js";
import { notFound, badRequest } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { z } from "zod";

const createSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

const updateSchema = createSchema.partial();

export async function list(req, res) {
  const faqs = await getDb().faq.findMany({
    orderBy: { sortOrder: 'asc' }
  });
  return ResponseFormatter.success(res, { message: getMessage("faqsFetched"), data: faqs });
}

export async function create(req, res) {
  const body = createSchema.parse(req.body);
  const faq = await getDb().faq.create({
    data: body
  });
  return ResponseFormatter.success(res, { message: getMessage("faqCreated"), data: faq, status: 201 });
}

export async function update(req, res) {
  const { id } = req.params;
  const body = updateSchema.parse(req.body);
  
  const existing = await getDb().faq.findUnique({ where: { id } });
  if (!existing) throw notFound("faqNotFound");
  
  const faq = await getDb().faq.update({
    where: { id },
    data: body
  });
  return ResponseFormatter.success(res, { message: getMessage("faqUpdated"), data: faq });
}

export async function remove(req, res) {
  const { id } = req.params;
  const existing = await getDb().faq.findUnique({ where: { id } });
  if (!existing) throw notFound("faqNotFound");
  
  await getDb().faq.delete({ where: { id } });
  return ResponseFormatter.success(res, { message: getMessage("faqDeleted") });
}
