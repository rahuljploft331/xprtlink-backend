import { Router } from "express";
import { list, getById, create, update, remove } from "#controllers/categories.controller.js";
import { requireAdmin } from "#middlewares/adminAuth.js";

const router = Router();
router.use(requireAdmin);
router.get("/", list);
router.get("/:id", getById);
router.post("/", create);
router.patch("/:id", update);
router.delete("/:id", remove);
export default router;
