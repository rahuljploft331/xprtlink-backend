import fs from 'fs';
const file = './services/user-service/src/routes/users.routes.js';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('let actualUserId = blockedUserId;')) {
  code = code.replace(
    `const blockedUserId = req.params.id;`,
    `const blockedUserId = req.params.id;
    let actualUserId = blockedUserId;
    const targetUser = await db.user.findUnique({ where: { id: actualUserId } });
    if (!targetUser) {
      const expert = await db.expertProfile.findUnique({ where: { id: blockedUserId } });
      if (expert) actualUserId = expert.userId;
      else {
        const customer = await db.customerProfile.findUnique({ where: { id: blockedUserId } });
        if (customer) actualUserId = customer.userId;
      }
    }`
  ).replace(
    `blockedUserId,\n          },`,
    `blockedUserId: actualUserId,\n          },`
  );
  fs.writeFileSync(file, code);
  console.log("Patched unblock logic");
}
