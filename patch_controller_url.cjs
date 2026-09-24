const fs = require('fs');
const path = 'services/admin-service/src/controllers/supportTickets.controller.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `attachment: { select: { id: true, url: true } }`,
  `attachment: { select: { id: true, storageKey: true } }`
);
content = content.replace(
  `attachment: { select: { id: true, url: true } }`,
  `attachment: { select: { id: true, storageKey: true } }`
);

fs.writeFileSync(path, content);
