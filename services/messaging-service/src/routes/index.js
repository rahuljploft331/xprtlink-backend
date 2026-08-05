import { Router } from "express";
import messagingRoutes from "./messaging.routes.js";

const router = Router();

router.use("/v1/messaging", messagingRoutes);

export default router;
