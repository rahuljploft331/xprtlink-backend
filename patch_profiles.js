import fs from 'fs';
const file = './services/user-service/src/routes/users.routes.js';
let code = fs.readFileSync(file, 'utf8');

// Replace the internalPost for user-blocked
code = code.replace(
  `      await internalPost(serviceUrls.messaging, '/internal/events/user-blocked', {
        blockerUserId: req.auth.userId,
        blockedUserId: actualUserId,
      });`,
  `      const [blockerE, blockerC, blockedE, blockedC] = await Promise.all([
        db.expertProfile.findUnique({ where: { userId: req.auth.userId } }),
        db.customerProfile.findUnique({ where: { userId: req.auth.userId } }),
        db.expertProfile.findUnique({ where: { userId: actualUserId } }),
        db.customerProfile.findUnique({ where: { userId: actualUserId } }),
      ]);
      await internalPost(serviceUrls.messaging, '/internal/events/user-blocked', {
        blockerUserId: req.auth.userId,
        blockedUserId: actualUserId,
        blockerProfileIds: [blockerE?.id, blockerC?.id].filter(Boolean),
        blockedProfileIds: [blockedE?.id, blockedC?.id].filter(Boolean),
      });`
);

// Replace the internalPost for user-unblocked
code = code.replace(
  `      await internalPost(serviceUrls.messaging, '/internal/events/user-unblocked', {
        blockerUserId: req.auth.userId,
        blockedUserId: actualUserId,
      });`,
  `      const [blockerE, blockerC, blockedE, blockedC] = await Promise.all([
        db.expertProfile.findUnique({ where: { userId: req.auth.userId } }),
        db.customerProfile.findUnique({ where: { userId: req.auth.userId } }),
        db.expertProfile.findUnique({ where: { userId: actualUserId } }),
        db.customerProfile.findUnique({ where: { userId: actualUserId } }),
      ]);
      await internalPost(serviceUrls.messaging, '/internal/events/user-unblocked', {
        blockerUserId: req.auth.userId,
        blockedUserId: actualUserId,
        blockerProfileIds: [blockerE?.id, blockerC?.id].filter(Boolean),
        blockedProfileIds: [blockedE?.id, blockedC?.id].filter(Boolean),
      });`
);

fs.writeFileSync(file, code);
console.log("Patched user-service to include profile IDs");
