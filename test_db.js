import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:ASDLK%40%5E%24%26%3F%2A%23456SD%3F%40%24%5EyEFfgw55@localhost:5433/db01?schema=public"
    }
  }
});
async function main() {
  const userId = '9aceabdc-1c37-455e-b492-ba3483640284';
  const callerId = 'dadf9f79-cfaa-4c2e-adab-9932ff365ef9';
  
  const user = await prisma.user.findUnique({ where: { id: userId }});
  console.log("Target user:", user ? "EXISTS" : "MISSING");
  
  const caller = await prisma.user.findUnique({ where: { id: callerId }});
  console.log("Caller user:", caller ? "EXISTS" : "MISSING");
  
  const total = await prisma.user.count();
  console.log("Total users in PROD DB:", total);
}
main().catch(console.error).finally(() => prisma.$disconnect());
