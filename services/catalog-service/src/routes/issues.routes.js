import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { createPlatformIssueSchema } from "@xprtlink/shared/contracts/index.js";
import * as svc from "../services/platformIssueService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";

const router = Router();

router.use(authenticate);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createPlatformIssueSchema.parse(req.body);
    const data = await svc.createIssue(req.auth, body);
    // Let's add issueSubmitted to messages.json if not present
    return ResponseFormatter.success(res, { message: getMessage("issueSubmitted"), data, status: 201 });
  })
);

export default router;
