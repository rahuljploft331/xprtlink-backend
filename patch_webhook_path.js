import fs from 'fs';
const file = './services/user-service/src/routes/users.routes.js';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  `await internalPost(serviceUrls.messaging, '/internal/events/user-blocked'`,
  `await internalPost(serviceUrls.messaging, '/api/internal/events/user-blocked'`
);

code = code.replace(
  `await internalPost(serviceUrls.messaging, '/internal/events/user-unblocked'`,
  `await internalPost(serviceUrls.messaging, '/api/internal/events/user-unblocked'`
);

fs.writeFileSync(file, code);
