import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { createPlatformIssueSchema } from "@xprtlink/shared/contracts/index.js";
import * as svc from "../services/platformIssueService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";

const router = Router();

router.use(authenticate);

router.get("/options", (req, res) => {
  const categories = [
    "Technical Bug",
    "Billing & Payments",
    "Account & Security",
    "Consultations",
    "General Inquiry",
    "Other"
  ];
  
  const urgencies = [
    "Low - General Feedback",
    "Medium - Affects My Work",
    "High - Blocking Consultations",
    "Critical - Payment or Security"
  ];

  return ResponseFormatter.success(res, {
    data: { categories, urgencies },
    status: 200
  });
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createPlatformIssueSchema.parse(req.body);
    const data = await svc.createIssue(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("issueSubmitted"), data, status: 201 });
  })
);

export default router;
