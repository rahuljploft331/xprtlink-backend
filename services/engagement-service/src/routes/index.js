import { Router } from "express";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import quotesRoutes from "./quotes.routes.js";
import consultationsRoutes from "./consultations.routes.js";
import reviewsRoutes from "./reviews.routes.js";
import reportsRoutes from "./reports.routes.js";
import webhooksRoutes from "./webhooks.routes.js";
import { expireStaleQuotes } from "../crons/expireQuotes.js";

const router = Router();

// Note: UUID validation for :id params is applied inside each child router
// (quotes.routes.js, consultations.routes.js) via validateUUID, because a
// router.param callback on this parent router does not fire for params that
// are matched by mounted child routers.

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
