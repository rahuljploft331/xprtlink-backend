import { Router } from "express";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getDb } from "@xprtlink/shared/db";
import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { internalPost } from "@xprtlink/shared/lib/internalFetch.js";
import { getConfig } from "@xprtlink/shared/config/loadEnv.js";

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

    
    try {
      const { serviceUrls } = getConfig("user-service");
      const [blockerE, blockerC, blockedE, blockedC] = await Promise.all([
        db.expertProfile.findUnique({ where: { userId: req.auth.userId } }),
        db.customerProfile.findUnique({ where: { userId: req.auth.userId } }),
        db.expertProfile.findUnique({ where: { userId: actualUserId } }),
        db.customerProfile.findUnique({ where: { userId: actualUserId } }),
      ]);
      await internalPost(serviceUrls.messaging, '/internal/events/user-blocked', {
        blockerUserId: req.auth.userId,
        blockedUserId: actualUserId,
        blockerProfileIds: [blockerE?.id, blockerC?.id].filter(Boolean),
        blockedProfileIds: [blockedE?.id, blockedC?.id].filter(Boolean),
      });
    } catch(err) {
      console.error("[user-service] Failed to broadcast block event:", err.message);
    }

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
    let actualUserId = blockedUserId;
    const targetUser = await db.user.findUnique({ where: { id: actualUserId } });
    if (!targetUser) {
      const expert = await db.expertProfile.findUnique({ where: { id: blockedUserId } });
      if (expert) actualUserId = expert.userId;
      else {
        const customer = await db.customerProfile.findUnique({ where: { id: blockedUserId } });
        if (customer) actualUserId = customer.userId;
      }
    }

    try {
      await db.userBlock.delete({
        where: {
          blockerUserId_blockedUserId: {
            blockerUserId: req.auth.userId,
            blockedUserId: actualUserId,
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


    try {
      const { serviceUrls } = getConfig("user-service");
      const [blockerE, blockerC, blockedE, blockedC] = await Promise.all([
        db.expertProfile.findUnique({ where: { userId: req.auth.userId } }),
        db.customerProfile.findUnique({ where: { userId: req.auth.userId } }),
        db.expertProfile.findUnique({ where: { userId: actualUserId } }),
        db.customerProfile.findUnique({ where: { userId: actualUserId } }),
      ]);
      await internalPost(serviceUrls.messaging, '/internal/events/user-unblocked', {
        blockerUserId: req.auth.userId,
        blockedUserId: actualUserId,
        blockerProfileIds: [blockerE?.id, blockerC?.id].filter(Boolean),
        blockedProfileIds: [blockedE?.id, blockedC?.id].filter(Boolean),
      });
    } catch(err) {
      console.error("[user-service] Failed to broadcast unblock event:", err.message);
    }

    return ResponseFormatter.success(res, {
      message: getMessage("userBlockRemoved"),
      status: 200,
    });
  })
);

export default router;
