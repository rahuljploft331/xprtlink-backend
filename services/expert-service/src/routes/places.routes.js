import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate, requireRole } from "@xprtlink/shared/middleware/auth.js";
import { createRateLimiter } from "@xprtlink/shared/middleware/rateLimiter.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import * as places from "../services/placesService.js";

const router = Router();

// Every call costs money on Google's side, so limit per signed-in expert (not per IP: behind the gateway
// every request would share the gateway's address). Runs after `authenticate`, so req.auth is set.
const perUser = (max, what) =>
  createRateLimiter({
    windowMs: 60 * 1000,
    max,
    keyGenerator: (req) => `places:${req.auth.userId}`,
    message: {
      success: false,
      message: `Too many ${what} requests. Please slow down and try again in a minute.`,
      code: "PLACES_RATE_LIMIT_EXCEEDED",
    },
  });
const autocompleteLimit = perUser(40, "place search");
const detailsLimit = perUser(30, "place lookup");

router.get(
  "/autocomplete",
  authenticate,
  requireRole("expert"),
  autocompleteLimit,
  asyncHandler(async (req, res) => {
    const data = await places.autocompletePlaces({ q: req.query.q, sessionToken: req.query.sessionToken });
    return ResponseFormatter.success(res, { message: getMessage("placeSuggestions"), data });
  })
);

router.get(
  "/details",
  authenticate,
  requireRole("expert"),
  detailsLimit,
  asyncHandler(async (req, res) => {
    const data = await places.getPlaceLocation({ placeId: req.query.placeId, sessionToken: req.query.sessionToken });
    return ResponseFormatter.success(res, { message: getMessage("placeDetails"), data });
  })
);

export default router;
