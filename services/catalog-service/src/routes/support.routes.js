import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { createSupportTicketSchema } from "@xprtlink/shared/contracts/index.js";
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
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSupportTicketSchema.parse(req.body);
    const data = await svc.createTicket(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("ticketCreated"), data, status: 201 });
  })
);

export default router;
