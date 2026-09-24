const fs = require('fs');
const path = './services/catalog-service/src/services/supportTicketService.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  'export async function createTicket(auth, { subject, body, category }) {',
  'export async function createTicket(auth, { subject, body, category, referenceId, attachmentId }) {'
);

content = content.replace(
  `  const user = await db.user.findUnique({
    where: { id: auth.userId },
    select: { email: true, firstName: true, lastName: true, phone: true }
  });`,
  `  const user = await db.user.findUnique({
    where: { id: auth.userId },
    include: { customerProfile: true, expertProfile: true }
  });
  const profile = user?.customerProfile || user?.expertProfile || {};
  const firstName = profile.firstName || '';
  const lastName = profile.lastName || '';`
);

content = content.replace(
  `  // Also log the ticket just for record keeping, even though the admin portal won't show it anymore
  const ticket = await db.supportTicket.create({
    data: {
      userId: auth.userId,
      subject,
      body,
      category,
      status: "open",
    },
  });`,
  `  const finalSubject = subject || \`Support Ticket - \${category}\`;
  
  const ticket = await db.supportTicket.create({
    data: {
      userId: auth.userId,
      subject: finalSubject,
      body,
      category,
      referenceId,
      attachmentId,
      status: "open",
    },
  });`
);

content = content.replace(
  'const userName = `${user?.firstName || \'\'} ${user?.lastName || \'\'}`.trim() || \'User\';',
  'const userName = `${firstName} ${lastName}`.trim() || \'User\';'
);

content = content.replace(
  'subject: `[Support] ${subject}`,',
  'subject: `[Support] ${finalSubject}`,'
);

content = content.replace(
  'Subject: ${subject}\\n',
  'Subject: ${finalSubject}\\n'
);

fs.writeFileSync(path, content);
