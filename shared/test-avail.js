import { getDb } from './db/getClient.js';
async function main() {
  const db = getDb();
  const row = await db.user.findFirst({
    where: { phone: '+918955102520' },
    include: { customerProfile: true, expertProfile: true }
  });
  console.log('User:', row ? row.id : null);
  console.log('Customer:', row ? !!row.customerProfile : false);
  console.log('Expert:', row ? !!row.expertProfile : false);
  const avail = !row || (!row.customerProfile || !row.expertProfile);
  console.log('Available:', avail);
}
main().catch(console.error);
