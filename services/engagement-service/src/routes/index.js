import { Router } from "express";
import { validateUUID } from "@xprtlink/shared/middleware/validateUUID.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import quotesRoutes from "./quotes.routes.js";
import consultationsRoutes from "./consultations.routes.js";
import reviewsRoutes from "./reviews.routes.js";
import reportsRoutes from "./reports.routes.js";
import webhooksRoutes from "./webhooks.routes.js";
import { expireStaleQuotes } from "../crons/expireQuotes.js";

const router = Router();

// Validate UUID route params across all engagement routes
router.param("id", (req, _res, next, value) => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(value)) {
    const err = new Error(`Invalid UUID for parameter "id": ${value}`);
    err.statusCode = 400;
    err.code = "INVALID_UUID";
    return next(err);
  }
  next();
});

router.use("/v1/engagement/quotes", quotesRoutes);
router.use("/v1/engagement/consultations", consultationsRoutes);
router.use("/v1/engagement/reviews", reviewsRoutes);
router.use("/v1/engagement/reports", reportsRoutes);
router.use("/v1/engagement/webhooks", webhooksRoutes);

// Internal cron endpoint — expire stale quotes. Protected by SERVICE_SECRET.
router.post(
  "/v1/engagement/quotes/expire",
  asyncHandler(async (req, res) => {
    const secret = process.env.SERVICE_SECRET;
    const header = req.headers["x-internal-service"];
    if (!header || (secret && header !== secret)) {
      return res.status(403).json({ success: false, message: "Internal endpoint" });
    }
    const data = await expireStaleQuotes();
    return ResponseFormatter.success(res, { message: `Expired ${data.expired} quote(s)`, data });
  })
);

export default router;
