import { Router } from "express";
import mediaRoutes from "./media.routes.js";

const router = Router();

router.use("/v1/media", mediaRoutes);

export default router;
