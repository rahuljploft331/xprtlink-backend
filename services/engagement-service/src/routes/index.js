import { Router } from "express";
import quotesRoutes from "./quotes.routes.js";
import consultationsRoutes from "./consultations.routes.js";
import reviewsRoutes from "./reviews.routes.js";
import reportsRoutes from "./reports.routes.js";
import webhooksRoutes from "./webhooks.routes.js";

const router = Router();

router.use("/v1/engagement/quotes", quotesRoutes);
router.use("/v1/engagement/consultations", consultationsRoutes);
router.use("/v1/engagement/reviews", reviewsRoutes);
router.use("/v1/engagement/reports", reportsRoutes);
router.use("/v1/engagement/webhooks", webhooksRoutes);

export default router;
