import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import {
  createQuoteRequestSchema,
  updateQuoteRequestSchema,
  submitQuotationRequestSchema,
} from "@xprtlink/shared/contracts";
import * as svc from "../services/engagementService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


const router = Router();

router.use(authenticate);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createQuoteRequestSchema.parse(req.body);
    const data = await svc.createQuote(req.auth, body);
    return ResponseFormatter.success(res, { message: getMessage("quoteRequestCreated"), data, status: 201 });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = updateQuoteRequestSchema.parse(req.body);
    const data = await svc.updateQuote(req.auth, req.params.id, body);
    return ResponseFormatter.success(res, { message: getMessage("quoteUpdated"), data });
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await svc.listQuotes(req.auth, req.query);
    return ResponseFormatter.paginated(res, { message: getMessage("quotesLoaded"), ...data });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = await svc.getQuote(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("quoteLoaded"), data });
  })
);

router.post(
  "/:id/quotation",
  asyncHandler(async (req, res) => {
    const body = submitQuotationRequestSchema.parse(req.body);
    const data = await svc.submitQuotation(req.auth, req.params.id, body);
    return ResponseFormatter.success(res, { message: getMessage("quotationSubmitted"), data });
  })
);

router.post(
  "/:id/accept",
  asyncHandler(async (req, res) => {
    const data = await svc.acceptQuote(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("quoteAccepted"), data });
  })
);

router.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const data = await svc.rejectQuote(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("quoteRejected"), data });
  })
);

router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const data = await svc.cancelQuote(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("quoteCanceled"), data });
  })
);

router.get(
  "/:id/history",
  asyncHandler(async (req, res) => {
    const data = await svc.getQuoteHistory(req.auth, req.params.id);
    return ResponseFormatter.success(res, { message: getMessage("quoteHistoryLoaded"), data });
  })
);

export default router;
