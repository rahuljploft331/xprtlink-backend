import { getDb } from './db/index.js';

async function main() {
  const db = getDb();
  const userId = '9aceabdc-1c37-455e-b492-ba3483640284';
  const user = await db.user.findUnique({ where: { id: userId } });
  if (user) {
    console.log("Found User ID:", user.id);
  } else {
    console.log("User ID NOT FOUND.");
  }
  
  // Is it an Expert Profile ID?
  const expert = await db.expertProfile.findUnique({ where: { id: userId } });
  if (expert) {
    console.log("Found Expert Profile ID!", expert.id, "Belongs to User:", expert.userId);
  } else {
    console.log("Expert Profile ID NOT FOUND.");
  }

  // Is it a Customer Profile ID?
  const customer = await db.customerProfile.findUnique({ where: { id: userId } });
  if (customer) {
    console.log("Found Customer Profile ID!", customer.id, "Belongs to User:", customer.userId);
  }
}
main().catch(console.error).finally(() => process.exit(0));
