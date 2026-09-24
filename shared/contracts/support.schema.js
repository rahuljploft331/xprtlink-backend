import { z } from "zod";

export const SUPPORT_TICKET_CATEGORIES = [
  "billing",
  "account",
  "technical",
  "expert_issue",
  "consultation",
  "other",
];

export const createSupportTicketSchema = z.object({
  subject: z.string().min(5).max(200).optional(),
  body: z.string().min(10).max(5000),
  category: z.enum(SUPPORT_TICKET_CATEGORIES),
  referenceId: z.string().max(100).optional(),
  attachmentId: z.string().uuid().optional(),
});

export const listSupportTicketsSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
