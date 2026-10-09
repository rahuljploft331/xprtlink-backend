import { getDb } from "./shared/db/index.js";
async function run() {
  const db = getDb();
  const conv = await db.conversation.findFirst({
    include: { expert: true }
  });
  console.log("expert.userId:", conv.expert.userId);
  console.log("expertId (profile ID):", conv.expert.id);
}
run().catch(console.error).finally(() => process.exit(0));
