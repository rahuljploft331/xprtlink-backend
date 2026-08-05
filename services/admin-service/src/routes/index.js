import { Router } from "express";
import authRoutes from "./auth.routes.js";
import dashboardRoutes from "./dashboard.routes.js";
import customersRoutes from "./customers.routes.js";
import expertsRoutes from "./experts.routes.js";
import verificationsRoutes from "./verifications.routes.js";
import categoriesRoutes from "./categories.routes.js";
import consultationsRoutes from "./consultations.routes.js";
import quotesRoutes from "./quotes.routes.js";
import paymentsRoutes from "./payments.routes.js";
import payoutsRoutes from "./payouts.routes.js";
import subscriptionsRoutes from "./subscriptions.routes.js";
import reviewsRoutes from "./reviews.routes.js";
import cmsRoutes from "./cms.routes.js";
import adminsRoutes from "./admins.routes.js";
import notificationsRoutes from "./notifications.routes.js";

const router = Router();

/* ── Public ─────────────────────────────────────────── */
router.use("/auth", authRoutes);

/* ── Protected domain routes ────────────────────────── */
router.use("/dashboard", dashboardRoutes);
router.use("/customers", customersRoutes);
router.use("/experts", expertsRoutes);
router.use("/verifications", verificationsRoutes);
router.use("/categories", categoriesRoutes);
router.use("/consultations", consultationsRoutes);
router.use("/quotes", quotesRoutes);
router.use("/payments", paymentsRoutes);
router.use("/payouts", payoutsRoutes);
router.use("/subscriptions", subscriptionsRoutes);
router.use("/reviews", reviewsRoutes);
router.use("/cms", cmsRoutes);
router.use("/admins", adminsRoutes);
router.use("/notifications", notificationsRoutes);

export default router;

