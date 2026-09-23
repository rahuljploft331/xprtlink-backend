import { getDb } from './db/index.js';

async function main() {
  const db = getDb();
  const id = '9aceabdc-1c37-455e-b492-ba3483640284';
  
  const customerProfile = await db.customerProfile.findUnique({ where: { id: id } });
  if (customerProfile) console.log("Found CustomerProfile ID:", customerProfile);
  
  const expertProfile = await db.expertProfile.findUnique({ where: { id: id } });
  if (expertProfile) console.log("Found ExpertProfile ID:", expertProfile);
  
  const user = await db.user.findUnique({ where: { id: id } });
  if (user) console.log("Found User ID:", user);
}
main().catch(console.error).finally(() => process.exit(0));
