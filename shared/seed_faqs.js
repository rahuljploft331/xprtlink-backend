import { getDb } from './db/index.js';

const faqs = [
  {
    question: 'How do I verify my expert credentials?',
    answer: 'Upload your professional licence or certification under Profile → Edit Profile. Our Trust & Safety team reviews new submissions within two business days.',
    sortOrder: 1,
    isActive: true
  },
  {
    question: 'What is the platform commission for consultants?',
    answer: 'XprtLink retains a flat platform fee per completed session. The exact amount is always itemised on your receipt before you confirm payment.',
    sortOrder: 2,
    isActive: true
  },
  {
    question: 'How do I schedule an emergency consultation?',
    answer: 'Open an expert profile and choose Request a Quote, then flag the request as urgent. Experts who are online are notified immediately.',
    sortOrder: 3,
    isActive: true
  }
];

async function main() {
  const prisma = getDb();
  const count = await prisma.faq.count();
  if (count === 0) {
    for (const faq of faqs) {
      await prisma.faq.create({ data: faq });
    }
    console.log('Seeded initial FAQs');
  } else {
    console.log('FAQs already seeded');
  }
}

main().catch(console.error);
