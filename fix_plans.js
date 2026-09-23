import { getDb } from './shared/db/index.js';

async function main() {
  const prisma = getDb();
  await prisma.subscriptionPlan.updateMany({
    where: { code: 'core_subscription' },
    data: { code: 'core' },
  });
  await prisma.subscriptionPlan.updateMany({
    where: { code: 'professional_subscription' },
    data: { code: 'professional' },
  });
  await prisma.subscriptionPlan.updateMany({
    where: { code: 'elite_subscription' },
    data: { code: 'elite' },
  });
  console.log('Plans updated.');
}

main().catch(console.error).finally(() => process.exit(0));
