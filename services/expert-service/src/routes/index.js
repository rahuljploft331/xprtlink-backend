import { Router } from "express";
import expertsRoutes from "./experts.routes.js";
import searchRoutes from "./search.routes.js";

const router = Router();

// Validate UUID route params across all expert routes
router.param("id", (req, _res, next, value) => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(value)) {
    const err = new Error(`Invalid UUID for parameter "id": ${value}`);
    err.statusCode = 400;
    err.code = "INVALID_UUID";
    return next(err);
  }
  next();
});

router.use("/v1/experts", expertsRoutes);
router.use("/v1/search", searchRoutes);
export default router;
