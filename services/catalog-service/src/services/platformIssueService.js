import { getDb } from "@xprtlink/shared/db/index.js";

export async function createIssue(auth, payload) {
  const db = getDb();
  
  const issue = await db.platformIssue.create({
    data: {
      userId: auth.userId,
      category: payload.category,
      urgency: payload.urgency,
      description: payload.description,
    },
  });

  return issue;
}
