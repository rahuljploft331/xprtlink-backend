import { getDb } from './shared/db/getClient.js';
async function main() {
  const prisma = getDb();
  const user = await prisma.user.findFirst({
    where: { email: 'deepak@customer.com' }
  });
  console.log("User:", user);
  const otp = await prisma.otpChallenge.findMany({
    where: { email: 'deepak@customer.com' }
  });
  console.log("OTPs:", otp);
}
main().catch(console.error);
