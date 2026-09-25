import { Router } from "express";
import billingRoutes from "./billing.routes.js";

const router = Router();

router.use("/v1/billing", billingRoutes);

export default router;
