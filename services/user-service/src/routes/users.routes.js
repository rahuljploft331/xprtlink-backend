import { Router } from "express";
import { asyncHandler } from "@xprtlink/shared/middleware/asyncHandler.js";
import { authenticate } from "@xprtlink/shared/middleware/auth.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getDb } from "@xprtlink/shared/db/prisma.js";

const router = Router();

router.use(authenticate);

// Block a user
router.post(
  "/me/blocks",
  asyncHandler(async (req, res) => {
    const { userIdToBlock } = req.body;
    if (!userIdToBlock) {
      return res.status(400).json({ success: false, message: "userIdToBlock is required" });
    }

    const db = getDb();
    
    // Check if target user exists
    const targetUser = await db.user.findUnique({ where: { id: userIdToBlock } });
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "Target user not found" });
    }

    if (userIdToBlock === req.auth.id) {
      return res.status(400).json({ success: false, message: "You cannot block yourself" });
    }

    await db.userBlock.upsert({
      where: {
        blockerUserId_blockedUserId: {
          blockerUserId: req.auth.id,
          blockedUserId: userIdToBlock,
        },
      },
      update: {},
      create: {
        blockerUserId: req.auth.id,
        blockedUserId: userIdToBlock,
      },
    });

    return ResponseFormatter.success(res, {
      message: "User blocked successfully",
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
            blockerUserId: req.auth.id,
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
      message: "User unblocked successfully",
      status: 200,
    });
  })
);

export default router;
