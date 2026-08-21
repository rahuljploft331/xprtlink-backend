import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { createSupportTicketSchema, listSupportTicketsSchema } from "@xprtlink/shared/contracts";
import * as svc from "../services/supportTicketService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


const router = Router();

// All support ticket endpoints require a logged-in user (customer or expert).
router.use(authenticate);

/**
 * GET /api/v1/catalog/support/tickets
 * List the authenticated user's own support tickets.
 * Query: status?, page?, limit?
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listSupportTicketsSchema.parse(req.query);
    const data = await svc.listMyTickets(req.auth, query);
    return ResponseFormatter.success(res, { message: getMessage("supportTickets"), data });
  })
);

/**
 * POST /api/v1/catalog/support/tickets
 * Create a new support ticket.
 * Body: { subject, body, category }
 */
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSupportTicketSchema.parse(req.body);
    const data = await svc.createTicket(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("ticketCreated"), data, status: 201 });
  })
);

/**
 * GET /api/v1/catalog/support/tickets/:id
 * Get a single ticket by ID (must belong to the authenticated user).
 */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = await svc.getTicket(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("supportTicket"), data });
  })
);

export default router;
