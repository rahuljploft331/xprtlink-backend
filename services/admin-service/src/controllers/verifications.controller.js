import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";

/** GET /api/v1/admin/verifications */
export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const status = req.query.status;
    const where = status ? { status } : {};

    const [total, verifications] = await Promise.all([
      db.expertVerification.count({ where }),
      db.expertVerification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { submittedAt: "desc" },
        include: {
          expert: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { documents: true } },
        },
      }),
    ]);

    const items = verifications.map((v) => ({
      id: v.id,
      expert: v.expert,
      status: v.status,
      submittedAt: v.submittedAt,
      reviewedAt: v.reviewedAt,
      reviewNotes: v.reviewNotes,
      documentCount: v._count.documents,
    }));

    return ResponseFormatter.paginated(res, { items, page, limit, total });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/admin/verifications/:id */
export async function getById(req, res, next) {
  try {
    const db = getDb();
    const v = await db.expertVerification.findUnique({
      where: { id: req.params.id },
      include: {
        expert: { include: { user: { select: { email: true } } } },
        documents: { include: { media: true } },
      },
    });
    if (!v) {
      return res.status(404).json({ success: false, message: "Verification not found", code: "NOT_FOUND" });
    }
    return ResponseFormatter.success(res, { data: v });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/admin/verifications/:id/approve */
export async function approve(req, res, next) {
  try {
    const db = getDb();

    const result = await db.$transaction(async (tx) => {
      // 1. Update verification record
      const v = await tx.expertVerification.update({
        where: { id: req.params.id },
        data: {
          status: "approved",
          reviewedAt: new Date(),
          reviewNotes: req.body?.notes ?? null,
        },
      });

      // 2. Check if expert has an active subscription
      const activeSubscription = await tx.expertSubscription.findFirst({
        where: {
          expertProfileId: v.expertProfileId,
          status: "active",
        },
      });

      // 3. Update expert profile: always set verificationStatus,
      //    conditionally set searchEligible based on subscription
      await tx.expertProfile.update({
        where: { id: v.expertProfileId },
        data: {
          verificationStatus: "approved",
          searchEligible: !!activeSubscription,
        },
      });

      return v;
    });

    return ResponseFormatter.success(res, { message: "Verification approved", data: result });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/admin/verifications/:id/reject */
export async function reject(req, res, next) {
  try {
    const db = getDb();
    const v = await db.expertVerification.update({
      where: { id: req.params.id },
      data: {
        status: "rejected",
        reviewedAt: new Date(),
        reviewNotes: req.body?.notes ?? "Rejected by admin",
      },
    });
    await db.expertProfile.update({
      where: { id: v.expertProfileId },
      data: { verificationStatus: "rejected" },
    });
    return ResponseFormatter.success(res, { message: "Verification rejected", data: v });
  } catch (err) {
    next(err);
  }
}
