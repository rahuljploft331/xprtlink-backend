import { Router } from "express";
import notificationsRoutes from "./notifications.routes.js";

const router = Router();

router.use("/v1/notifications", notificationsRoutes);

export default router;
