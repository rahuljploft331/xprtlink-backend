import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { optionalAuthenticate } from "@xprtlink/shared/middleware/auth.js";
import * as svc from "../services/expertService.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


const router = Router();

router.get(
  "/experts",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const data = await svc.searchExperts(req.query, req.auth);
    return ResponseFormatter.paginated(res, { message: getMessage("searchResults"), ...data });
  })
);

export default router;
