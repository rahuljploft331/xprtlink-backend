const fs = require('fs');
const schemaPath = 'shared/prisma/schema.prisma';
let schema = fs.readFileSync(schemaPath, 'utf8');
schema = schema.replace(
  /subject        String              @db.VarChar\(200\)/,
  'subject        String?             @db.VarChar(200)'
);
fs.writeFileSync(schemaPath, schema);
