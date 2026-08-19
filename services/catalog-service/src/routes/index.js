import { Router } from "express";
import catalogRoutes from "./catalog.routes.js";
import supportRoutes from "./support.routes.js";

const router = Router();
router.use("/v1/catalog", catalogRoutes);
router.use("/v1/catalog/support/tickets", supportRoutes);
export default router;
