import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

const MAX_PER_GROUP = 5;

/**
 * GET /api/v1/admin/search?q=...
 * Fan-out search across customers, experts, verifications,
 * categories, consultations, quotes, payments, admins.
 * Returns grouped results, each with { module, label, items[] }.
 */
export async function globalSearch(req, res, next) {
  try {
    const q = (req.query.q ?? "").trim();
    if (q.length < 2) {
      return ResponseFormatter.success(res, { data: { groups: [], query: q } });
    }

    const db = getDb();
    const ci = { mode: "insensitive" };

    const [
      customers,
      experts,
      categories,
      consultations,
      quotes,
      admins,
    ] = await Promise.all([
      // Customers — match name or email
      db.user.findMany({
        where: {
          customerProfile: { isNot: null },
          OR: [
            { email: { contains: q, ...ci } },
            { customerProfile: { firstName: { contains: q, ...ci } } },
            { customerProfile: { lastName: { contains: q, ...ci } } },
          ],
        },
        take: MAX_PER_GROUP,
        include: { customerProfile: { select: { firstName: true, lastName: true } } },
      }),

      // Experts — match name
      db.expertProfile.findMany({
        where: {
          OR: [
            { firstName: { contains: q, ...ci } },
            { lastName: { contains: q, ...ci } },
          ],
        },
        take: MAX_PER_GROUP,
        include: { category: { select: { name: true } } },
      }),

      // Categories
      db.category.findMany({
        where: { name: { contains: q, ...ci } },
        take: MAX_PER_GROUP,
      }),

      // Consultations — search via related customer/expert names
      // NOTE: UUID id field does NOT support startsWith/contains in Prisma
      db.consultation.findMany({
        where: {
          OR: [
            { customer: { firstName: { contains: q, ...ci } } },
            { customer: { lastName: { contains: q, ...ci } } },
            { expert: { firstName: { contains: q, ...ci } } },
            { expert: { lastName: { contains: q, ...ci } } },
          ],
        },
        take: MAX_PER_GROUP,
        include: {
          customer: { select: { firstName: true, lastName: true } },
          expert: { select: { firstName: true, lastName: true } },
        },
      }),

      // Quotes — search by title only (UUID id does not support string filters)
      db.quoteRequest.findMany({
        where: {
          title: { contains: q, ...ci },
        },
        take: MAX_PER_GROUP,
        include: {
          customer: { select: { firstName: true, lastName: true } },
        },
      }),

      // Admins — match name or email
      db.adminUser.findMany({
        where: {
          OR: [
            { name: { contains: q, ...ci } },
            { email: { contains: q, ...ci } },
          ],
        },
        take: MAX_PER_GROUP,
      }),
    ]);

    const groups = [];

    if (customers.length > 0) {
      groups.push({
        module: "customers",
        label: "Customers",
        items: customers.map((u) => ({
          id: u.id,
          title: `${u.customerProfile?.firstName ?? ""} ${u.customerProfile?.lastName ?? ""}`.trim() || u.email,
          subtitle: u.email,
          href: `/customers/${u.id}`,
        })),
      });
    }

    if (experts.length > 0) {
      groups.push({
        module: "experts",
        label: "Experts",
        items: experts.map((e) => ({
          id: e.id,
          title: `${e.firstName} ${e.lastName}`,
          subtitle: e.category?.name ?? "Expert",
          href: `/experts/${e.id}`,
        })),
      });
    }

    if (categories.length > 0) {
      groups.push({
        module: "categories",
        label: "Categories",
        items: categories.map((c) => ({
          id: c.id,
          title: c.name,
          subtitle: c.isActive ? "Active" : "Inactive",
          href: `/categories`, // no detail page → go to listing
        })),
      });
    }

    if (consultations.length > 0) {
      groups.push({
        module: "consultations",
        label: "Consultations",
        items: consultations.map((c) => ({
          id: c.id,
          title: `Consultation #${c.id.slice(0, 8)}`,
          subtitle: c.customer && c.expert
            ? `${c.customer.firstName} ${c.customer.lastName} → ${c.expert.firstName} ${c.expert.lastName}`
            : c.status,
          href: `/consultations/${c.id}`,
        })),
      });
    }

    if (quotes.length > 0) {
      groups.push({
        module: "quotes",
        label: "Quotes",
        items: quotes.map((q) => ({
          id: q.id,
          title: q.title,
          subtitle: q.customer
            ? `${q.customer.firstName} ${q.customer.lastName}`
            : `Quote #${q.id.slice(0, 8)}`,
          href: `/quotes/${q.id}`,
        })),
      });
    }

    if (admins.length > 0) {
      groups.push({
        module: "admins",
        label: "Admin Users",
        items: admins.map((a) => ({
          id: a.id,
          title: a.name,
          subtitle: a.email,
          href: `/admins/${a.id}`,
        })),
      });
    }

    return ResponseFormatter.success(res, {
      data: { groups, query: q, total: groups.reduce((n, g) => n + g.items.length, 0) },
    });
  } catch (err) {
    next(err);
  }
}
