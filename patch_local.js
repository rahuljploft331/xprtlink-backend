import fs from 'fs';

const file = './services/user-service/src/routes/users.routes.js';
const code = fs.readFileSync(file, 'utf8');

const newCode = code.replace(
  `const targetUser = await db.user.findUnique({ where: { id: userIdToBlock } });`,
  `let actualUserId = userIdToBlock;
    let targetUser = await db.user.findUnique({ where: { id: actualUserId } });
    
    if (!targetUser) {
      // Flutter might send an ExpertProfile ID or CustomerProfile ID instead of the User ID. Resolve it:
      const expert = await db.expertProfile.findUnique({ where: { id: userIdToBlock } });
      if (expert) {
        actualUserId = expert.userId;
        targetUser = await db.user.findUnique({ where: { id: actualUserId } });
      } else {
        const customer = await db.customerProfile.findUnique({ where: { id: userIdToBlock } });
        if (customer) {
          actualUserId = customer.userId;
          targetUser = await db.user.findUnique({ where: { id: actualUserId } });
        }
      }
    }`
).replace(
  `if (userIdToBlock === req.auth.userId)`,
  `if (actualUserId === req.auth.userId)`
).replace(
  `blockedUserId: userIdToBlock,`,
  `blockedUserId: actualUserId,`
).replace(
  `blockedUserId: userIdToBlock,`,
  `blockedUserId: actualUserId,`
);

fs.writeFileSync(file, newCode);
console.log("Replaced user resolve logic.");
