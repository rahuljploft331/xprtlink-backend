import { getDb } from './db/index.js';

async function main() {
  const db = getDb();
  const callerId = 'dadf9f79-cfaa-4c2e-adab-9932ff365ef9';
  const targetId = '9aceabdc-1c37-455e-b492-ba3483640284';
  
  const caller = await db.user.findUnique({ where: { id: callerId } });
  if (caller) {
    console.log("Caller exists!", caller.id, caller.email);
  } else {
    console.log("Caller DOES NOT EXIST in DB!");
  }
}
main().catch(console.error).finally(() => process.exit(0));
