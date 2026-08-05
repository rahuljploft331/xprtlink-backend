import { Router } from "express";
import catalogRoutes from "./catalog.routes.js";

const router = Router();
router.use("/v1/catalog", catalogRoutes);
export default router;
