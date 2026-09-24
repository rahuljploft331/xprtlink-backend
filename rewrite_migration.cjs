const fs = require('fs');

let sql = fs.readFileSync('shared/prisma/migrations/20260924090710_add_faqs_table/migration.sql', 'utf8');

// 1. AlterEnum
sql = sql.replace(/ADD VALUE 'banner'/g, "ADD VALUE IF NOT EXISTS 'banner'");

// 2. AlterTable ADD COLUMN
sql = sql.replace(/ADD COLUMN\s+"([^"]+)"/g, 'ADD COLUMN IF NOT EXISTS "$1"');

// 3. CreateTable
sql = sql.replace(/CREATE TABLE "([^"]+)"/g, 'CREATE TABLE IF NOT EXISTS "$1"');

// 4. CreateIndex
sql = sql.replace(/CREATE INDEX "([^"]+)"/g, 'CREATE INDEX IF NOT EXISTS "$1"');
sql = sql.replace(/CREATE UNIQUE INDEX "([^"]+)"/g, 'CREATE UNIQUE INDEX IF NOT EXISTS "$1"');

// 5. Foreign keys
const fkRegex = /ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]+)\) REFERENCES "([^"]+)"\(([^)]+)\)(.*);/g;
sql = sql.replace(fkRegex, (match, table, constraint, fields, refTable, refFields, rest) => {
    return `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${constraint}') THEN
        ALTER TABLE "${table}" ADD CONSTRAINT "${constraint}" FOREIGN KEY (${fields}) REFERENCES "${refTable}"(${refFields})${rest};
    END IF;
END $$;`;
});

fs.writeFileSync('shared/prisma/migrations/20260924090710_add_faqs_table/migration.sql', sql);
