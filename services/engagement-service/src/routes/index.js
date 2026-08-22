import { Router } from "express";
import { validateUUID } from "@xprtlink/shared/middleware/validateUUID.js";
import quotesRoutes from "./quotes.routes.js";
import consultationsRoutes from "./consultations.routes.js";
import reviewsRoutes from "./reviews.routes.js";
import reportsRoutes from "./reports.routes.js";
import webhooksRoutes from "./webhooks.routes.js";

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

export default router;
