const fs = require('fs');
const routesPath = 'services/catalog-service/src/routes/support.routes.js';
let content = fs.readFileSync(routesPath, 'utf8');

content = content.replace(
  'import { createSupportTicketSchema } from "@xprtlink/shared/contracts/index.js";',
  'import { createSupportTicketSchema, SUPPORT_TICKET_CATEGORIES } from "@xprtlink/shared/contracts/index.js";'
);

content = content.replace(
  'router.post(',
  `/**
 * GET /api/v1/catalog/support/categories
 * Returns the valid categories for support tickets.
 */
router.get("/categories", (req, res) => {
  const categories = [
    { id: "billing", name: "Billing & Payments" },
    { id: "consultation", name: "Consultations" },
    { id: "account", name: "Account & Security" },
    { id: "expert_issue", name: "Expert Verification" },
    { id: "technical", name: "Technical Issue" },
    { id: "other", name: "Something else" }
  ];
  return ResponseFormatter.success(res, { data: categories, status: 200 });
});

router.post(`
);

fs.writeFileSync(routesPath, content);
