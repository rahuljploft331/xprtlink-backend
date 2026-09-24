const fs = require('fs');
const path = 'services/admin-service/src/controllers/supportTickets.controller.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `  if (role) {
    where.user = { role };
  }`,
  `  if (role) {
    if (role === "expert") {
      where.user = { expertProfile: { isNot: null } };
    } else if (role === "customer") {
      where.user = { customerProfile: { isNot: null } };
    }
  }`
);

content = content.replace(
  /user: \{ select: \{ id: true, firstName: true, lastName: true, email: true, role: true \} \}/g,
  `user: { select: { id: true, email: true, customerProfile: { select: { firstName: true, lastName: true } }, expertProfile: { select: { firstName: true, lastName: true } } } }`
);

content = content.replace(
  `  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: { user: true }
  });`,
  `  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: { user: { include: { customerProfile: true, expertProfile: true } } }
  });`
);

content = content.replace(
  `  const userName = \`\${user?.firstName || ''} \${user?.lastName || ''}\`.trim() || 'User';`,
  `  const profile = user?.customerProfile || user?.expertProfile || {};
  const userName = \`\${profile.firstName || ''} \${profile.lastName || ''}\`.trim() || 'User';`
);

fs.writeFileSync(path, content);
