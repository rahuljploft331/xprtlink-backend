const fs = require('fs');
const path = require('path');
const schemaPath = '/home/jploft-php/Documents/xpertlink/xpertlink-backend/shared/prisma/schema.prisma';

let content = fs.readFileSync(schemaPath, 'utf8');

const faqModel = `
model Faq {
  id        String   @id @default(uuid()) @db.Uuid
  question  String   @db.VarChar(500)
  answer    String   @db.Text
  sortOrder Int      @default(0) @map("sort_order")
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([isActive])
  @@map("faqs")
}
`;

if (!content.includes('model Faq {')) {
  content = content.replace('model PlatformSetting {', faqModel + '\nmodel PlatformSetting {');
  fs.writeFileSync(schemaPath, content);
  console.log('Faq model added to schema.prisma');
} else {
  console.log('Faq model already exists');
}
