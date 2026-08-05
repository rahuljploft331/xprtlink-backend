import { Router } from "express";
import expertsRoutes from "./experts.routes.js";
import searchRoutes from "./search.routes.js";

const router = Router();
router.use("/v1/experts", expertsRoutes);
router.use("/v1/search", searchRoutes);
export default router;
