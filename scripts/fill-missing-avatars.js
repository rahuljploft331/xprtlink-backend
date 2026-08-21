import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { getDb, disconnectDb } from "@xprtlink/shared/db/getClient.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client, getS3BucketName } from "@xprtlink/shared/utils/s3.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Gather photos
const femalePhotos = [
  "seeder/data/photos/female/0ef4fb566361e80ca99f818a8b5e9200383002fc.jpg",
  "seeder/data/photos/female/4be62b388ec3aa5861505e44555b314e5651c7fa.png",
  "seeder/data/photos/female/b023b22825c5f5c7b1835eacc84c40fdb95f5101.jpg",
  "seeder/data/photos/female/brantley-neal-UVUMHL-DzVM-unsplash.jpg",
];
const malePhotos = [
  "seeder/data/photos/male/albert-dera-ILip77SbmOE-unsplash.jpg",
  "seeder/data/photos/male/alex-suprun-ZHvM3XIOHoE-unsplash.jpg",
  "seeder/data/photos/male/ali-morshedlou-WMD64tMfc4k-unsplash.jpg",
  "seeder/data/photos/male/joseph-gonzalez-iFgRcqHznqg-unsplash.jpg",
  "seeder/data/photos/male/jurica-koletic-7YVZYZeITc8-unsplash.jpg",
];

const allPhotos = [...femalePhotos, ...malePhotos];

async function main() {
  const s3 = getS3Client();
  const bucket = getS3BucketName();
  
  if (!bucket) {
    console.log("No AWS_S3_BUCKET_NAME configured. Skipping avatar backfill.");
    return;
  }

  const db = getDb();

  // Find customers without avatars
  const customers = await db.customerProfile.findMany({
    where: { avatarMediaId: null },
    select: { id: true, userId: true }
  });

  // Find experts without avatars
  const experts = await db.expertProfile.findMany({
    where: { avatarMediaId: null },
    select: { id: true, userId: true }
  });

  if (customers.length === 0 && experts.length === 0) {
    console.log("All profiles already have avatars.");
    return;
  }

  console.log(`Found ${customers.length} customers and ${experts.length} experts without avatars. Backfilling...`);

  // Combine them
  const targets = [
    ...customers.map(c => ({ ...c, type: 'CustomerProfile' })),
    ...experts.map(e => ({ ...e, type: 'Expert' }))
  ];

  let uploaded = 0;

  for (const target of targets) {
    const photoPath = allPhotos[Math.floor(Math.random() * allPhotos.length)];
    const absolutePath = path.resolve(process.cwd(), photoPath);
    
    if (!fs.existsSync(absolutePath)) continue;

    const ext = path.extname(absolutePath);
    const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
    const fileBuffer = fs.readFileSync(absolutePath);
    const sizeBytes = fileBuffer.length;
    const mediaId = crypto.randomUUID();
    const storageKey = `seed/avatars/${mediaId}${ext}`;

    // Upload to S3
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: fileBuffer,
      ContentType: mimeType,
    }));

    // Create MediaAsset in DB
    await db.mediaAsset.create({
      data: {
        id: mediaId,
        ownerUserId: target.userId,
        purpose: "avatar",
        storageKey,
        mimeType,
        sizeBytes,
        status: "ready",
      }
    });

    // Link it
    if (target.type === 'CustomerProfile') {
      await db.customerProfile.update({
        where: { id: target.id },
        data: { avatarMediaId: mediaId }
      });
    } else {
      await db.expertProfile.update({
        where: { id: target.id },
        data: { avatarMediaId: mediaId }
      });
    }
    
    uploaded++;
  }

  console.log(`Successfully backfilled ${uploaded} avatars.`);
}

main()
  .catch((e) => console.error("Error backfilling avatars:", e))
  .finally(async () => {
    await disconnectDb();
  });
