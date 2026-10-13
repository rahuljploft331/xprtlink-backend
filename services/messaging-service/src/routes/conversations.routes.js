import { Router } from "express";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { badRequest } from "@xprtlink/shared/utils/errors.js";
import * as svc from "../services/messagingService.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Validate UUID route param
router.param("conversationId", (req, _res, next, value) => {
  if (!UUID_RE.test(value)) {
    return next(badRequest("conversationIdMustBeUuid", "INVALID_UUID", "conversationId"));
  }
  next();
});

router.use(authenticate);

// DELETE /api/v1/conversations/:conversationId
// Soft-delete (hide) conversation from caller's inbox
router.delete(
  "/:conversationId",
  asyncHandler(async (req, res) => {
    await svc.deleteConversation(req.auth, req.params.conversationId);
    return res.status(204).send();
  })
);

// POST /api/v1/conversations/:conversationId/restore
// Undo delete (restore hidden conversation)
router.post(
  "/:conversationId/restore",
  asyncHandler(async (req, res) => {
    await svc.restoreConversation(req.auth, req.params.conversationId);
    return ResponseFormatter.success(res, {
      message: getMessage("conversationRestored"),
    });
  })
);

export default router;
