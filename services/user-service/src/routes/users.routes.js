import { Router } from "express";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getDb } from "@xprtlink/shared/db";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";

const router = Router();

router.use(authenticate);

// Block a user
router.post(
  "/me/blocks",
  asyncHandler(async (req, res) => {
    const { userIdToBlock } = req.body;
    if (!userIdToBlock) {
      throw badRequest("missingRequiredFields");
    }

    const db = getDb();
    
    // Check if target user exists
    let actualUserId = userIdToBlock;
    let targetUser = await db.user.findUnique({ where: { id: actualUserId } });
    
    if (!targetUser) {
      // Flutter might send an ExpertProfile ID or CustomerProfile ID instead of the User ID. Resolve it:
      const expert = await db.expertProfile.findUnique({ where: { id: userIdToBlock } });
      if (expert) {
        actualUserId = expert.userId;
        targetUser = await db.user.findUnique({ where: { id: actualUserId } });
      } else {
        const customer = await db.customerProfile.findUnique({ where: { id: userIdToBlock } });
        if (customer) {
          actualUserId = customer.userId;
          targetUser = await db.user.findUnique({ where: { id: actualUserId } });
        }
      }
    }
    if (!targetUser) {
      throw notFound("userNotFound");
    }

    if (actualUserId === req.auth.userId) {
      throw badRequest("cannotBlockSelf");
    }

    await db.userBlock.upsert({
      where: {
        blockerUserId_blockedUserId: {
          blockerUserId: req.auth.userId,
          blockedUserId: actualUserId,
        },
      },
      update: {},
      create: {
        blockerUserId: req.auth.userId,
        blockedUserId: actualUserId,
      },
    });

    return ResponseFormatter.success(res, {
      message: getMessage("userBlockCreated"),
      status: 201,
    });
  })
);

// Unblock a user
router.delete(
  "/me/blocks/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const blockedUserId = req.params.id;

    try {
      await db.userBlock.delete({
        where: {
          blockerUserId_blockedUserId: {
            blockerUserId: req.auth.userId,
            blockedUserId,
          },
        },
      });
    } catch (err) {
      if (err.code === "P2025") {
        // Record to delete does not exist, which is fine for idempotent delete
      } else {
        throw err;
      }
    }

    return ResponseFormatter.success(res, {
      message: getMessage("userBlockRemoved"),
      status: 200,
    });
  })
);

export default router;
