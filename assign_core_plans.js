import { getDb } from './shared/db/index.js';

async function main() {
  const db = getDb();

  const corePlan = await db.subscriptionPlan.findUnique({
    where: { code: 'core' }
  });

  if (!corePlan) {
    console.error("Core plan not found!");
    process.exit(1);
  }

  const verifiedExperts = await db.expertProfile.findMany({
    where: { verificationStatus: 'approved' }
  });

  console.log(`Found ${verifiedExperts.length} verified experts.`);

  const now = new Date();
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  let updatedCount = 0;
  for (const expert of verifiedExperts) {
    await db.expertSubscription.updateMany({
      where: { expertProfileId: expert.id, status: 'active' },
      data: { status: 'canceled', canceledAt: now, cancelAtPeriodEnd: false }
    });

    const extId = `manual_core_${expert.id}_${Date.now()}`;
    await db.expertSubscription.create({
      data: {
        expertProfileId: expert.id,
        planId: corePlan.id,
        store: 'google',
        externalSubscriptionId: extId,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: nextMonth,
      }
    });

    await db.expertProfile.update({
      where: { id: expert.id },
      data: { searchEligible: true }
    });
    
    updatedCount++;
  }

  console.log(`Successfully assigned Core plan to ${updatedCount} experts.`);
  process.exit(0);
}

main().catch(console.error);
