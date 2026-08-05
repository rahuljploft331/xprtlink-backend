import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import {
  createConversationRequestSchema,
  sendMessageRequestSchema,
} from "@xprtlink/shared/contracts";
import * as svc from "../services/messagingService.js";

const router = Router();

router.use(authenticate);

router.get(
  "/conversations",
  asyncHandler(async (req, res) => {
    const data = await svc.listConversations(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: "Conversations", ...data });
  })
);

router.post(
  "/conversations",
  asyncHandler(async (req, res) => {
    const body = createConversationRequestSchema.parse(req.body);
    const data = await svc.createConversation(req.auth, body);
    return ResponseFormatter.success(res, { message: "Conversation ready", data, status: 201 });
  })
);

router.get(
  "/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    const data = await svc.listMessages(req.auth, req.params.id, req.query);
    return ResponseFormatter.paginated(res, { message: "Messages", ...data });
  })
);

router.post(
  "/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    const body = sendMessageRequestSchema.parse(req.body);
    const data = await svc.sendMessage(req.auth, req.params.id, body);
    return ResponseFormatter.success(res, { message: "Message sent", data, status: 201 });
  })
);

router.post(
  "/conversations/:id/read",
  asyncHandler(async (req, res) => {
    const data = await svc.markConversationRead(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: "Conversation marked read", data });
  })
);

export default router;
