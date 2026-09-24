import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { createSupportTicketSchema, SUPPORT_TICKET_CATEGORIES } from "@xprtlink/shared/contracts/index.js";
import * as svc from "../services/supportTicketService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";

const router = Router();

// All support ticket endpoints require a logged-in user (customer or expert).
router.use(authenticate);

/**
 * POST /api/v1/catalog/support/tickets
 * Submit a new support request.
 * Body: { subject, body, category }
 */
/**
 * GET /api/v1/catalog/support/categories
 * Returns the valid categories for support tickets.
 */
router.get("/categories", (req, res) => {
  const categories = [
    { id: "billing", name: "Billing & Payments" },
    { id: "consultation", name: "Consultations" },
    { id: "account", name: "Account & Security" },
    { id: "expert_issue", name: "Expert Verification" },
    { id: "technical", name: "Technical Issue" },
    { id: "other", name: "Something else" }
  ];
  return ResponseFormatter.success(res, { data: categories, status: 200 });
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSupportTicketSchema.parse(req.body);
    const data = await svc.createTicket(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("ticketCreated"), data, status: 201 });
  })
);

export default router;
