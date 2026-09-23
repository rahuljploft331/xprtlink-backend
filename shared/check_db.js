import { getDb } from './db/index.js';

async function main() {
  const db = getDb();
  const users = await db.user.findMany({ select: { id: true, email: true } });
  console.log(`Total users: ${users.length}`);
  if (users.length > 0) {
    console.table(users.slice(0, 10)); // Show up to 10
  }
}
main().catch(console.error).finally(() => process.exit(0));
