import { Router } from "express";
import authRoutes from "./auth.routes.js";
import customersRoutes from "./customers.routes.js";

const router = Router();

router.use("/v1/auth", authRoutes);
router.use("/v1/customers", customersRoutes);

export default router;
