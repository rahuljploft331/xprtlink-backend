import { PrismaClient } from './shared/node_modules/@prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  const sessions = await prisma.adminSession.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log(sessions);
}
main().catch(console.error).finally(() => prisma.$disconnect());
