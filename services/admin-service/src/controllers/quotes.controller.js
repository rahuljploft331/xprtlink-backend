import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


export async function list(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);
    const status = req.query.status;
    let where = {};
    if (status) {
      if (status === "submitted") {
        // Submitted quotes include newly submitted and those awaiting review
        where.status = { in: ["submitted", "pending_expert_review"] };
      } else if (status === "completed") {
        // In quote lifecycle, accepted is the terminal completed state
        where.status = "accepted";
      } else {
        where.status = status;
      }
    }
    const [total, items] = await Promise.all([
      db.quoteRequest.count({ where }),
      db.quoteRequest.findMany({
        where, skip, take: limit, orderBy: { createdAt: "desc" },
        include: {
          customer: { select: { firstName: true, lastName: true } },
          expert: { select: { firstName: true, lastName: true, categories: { select: { name: true } } } },
        },
      }),
    ]);

    const setting = await db.platformSetting.findUnique({ where: { key: "commissionPercent" } });
    const percent = Number(setting?.value);
    const rate = setting && Number.isFinite(percent) && percent >= 0 && percent <= 100
      ? percent / 100
      : 0.15;

    const enriched = items.map((q) => {
      const totalAmountCents = q.expertQuoteAmountCents ?? q.budgetCents ?? null;
      const commissionCents = totalAmountCents != null ? Math.round(totalAmountCents * rate) : null;
      const expertShareCents = totalAmountCents != null ? totalAmountCents - commissionCents : null;
      return {
        ...q,
        commissionCents,
        expertShareCents,
        charge: {
          transaction: { amountCents: totalAmountCents },
          commissionCents,
          expertShareCents,
        },
      };
    });

    return ResponseFormatter.paginated(res, { items: enriched, page, limit, total });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const db = getDb();
    const q = await db.quoteRequest.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        expert: { include: { categories: true } },
        statusEvents: {
          include: {
            actor: { select: { id: true, email: true, phone: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        attachments: { include: { media: true } },
      },
    });
    if (!q) return res.status(404).json({ success: false, message: getMessage("notFound"), code: "NOT_FOUND" });

    const totalAmountCents = q.expertQuoteAmountCents ?? q.budgetCents ?? null;
    let commissionCents = null;
    let expertShareCents = null;

    if (totalAmountCents != null) {
      const setting = await db.platformSetting.findUnique({ where: { key: "commissionPercent" } });
      const percent = Number(setting?.value);
      const rate = setting && Number.isFinite(percent) && percent >= 0 && percent <= 100
        ? percent / 100
        : 0.15;
      commissionCents = Math.round(totalAmountCents * rate);
      expertShareCents = totalAmountCents - commissionCents;
    }

    const data = {
      ...q,
      commissionCents,
      expertShareCents,
      charge: {
        transaction: {
          amountCents: totalAmountCents,
        },
        commissionCents,
        expertShareCents,
      },
    };

    return ResponseFormatter.success(res, { data });
  } catch (err) { next(err); }
}
