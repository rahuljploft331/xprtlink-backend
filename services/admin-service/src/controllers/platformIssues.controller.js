import { getDb } from "@xprtlink/shared/db/index.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";

export async function listIssues(req, res) {
  const { page = 1, limit = 20, status } = req.query;
  const db = getDb();
  
  const where = {};
  if (status) {
    where.status = status;
  }

  const issues = await db.platformIssue.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          customerProfile: { select: { firstName: true, lastName: true } },
          expertProfile: { select: { firstName: true, lastName: true } },
        }
      }
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: Number(limit),
  });

  const total = await db.platformIssue.count({ where });

  return ResponseFormatter.success(res, {
    data: issues,
    meta: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export async function updateIssueStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  const db = getDb();

  const issue = await db.platformIssue.update({
    where: { id },
    data: { status },
  });

  return ResponseFormatter.success(res, { data: issue, message: getMessage("issueStatusUpdated") });
}
