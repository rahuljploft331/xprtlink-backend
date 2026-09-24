const fs = require('fs');
const path = 'services/admin-service/src/controllers/supportTickets.controller.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `export async function reply(req, res) {
  const db = getDb();
  const { id } = req.params;
  const { message } = req.body;`,
  `export async function reply(req, res) {
  const db = getDb();
  const { id } = req.params;
  const { message, action } = req.body;`
);

content = content.replace(
  `  const updatedTicket = await db.supportTicket.update({
    where: { id },
    data: {
      status: "closed",
      resolutionNote: message,
      resolvedAt: new Date()
    }
  });`,
  `  const isClosing = action === "close";
  const updatedTicket = await db.supportTicket.update({
    where: { id },
    data: {
      status: isClosing ? "closed" : "in_progress",
      resolutionNote: message,
      ...(isClosing ? { resolvedAt: new Date() } : {})
    }
  });`
);

fs.writeFileSync(path, content);
