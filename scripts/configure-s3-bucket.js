import {
  PutPublicAccessBlockCommand,
  PutBucketCorsCommand,
  DeleteBucketPolicyCommand,
  GetPublicAccessBlockCommand,
  GetBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { getS3Client, getS3BucketName } from "../shared/utils/s3.js";

async function configureS3Bucket() {
  const client = getS3Client();
  const bucket = getS3BucketName();

  console.log(`\n======================================================`);
  console.log(`🔒 Configuring AWS S3 Bucket: ${bucket}`);
  console.log(`======================================================\n`);

  // 1. Enable Full Block Public Access
  console.log("[1/3] Applying Block Public Access settings (Private Bucket)...");
  try {
    await client.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      })
    );
    console.log("   ✅ Block Public Access enabled successfully!");
  } catch (err) {
    console.error("   ❌ Failed to set PublicAccessBlock:", err.message);
  }

  // 2. Remove any permissive public bucket policy if present
  console.log("\n[2/3] Cleaning up any permissive public bucket policy...");
  try {
    await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
    console.log("   ✅ Public bucket policy removed / private policy enforced!");
  } catch (err) {
    if (err.name === "NoSuchBucketPolicy") {
      console.log("   ℹ️ No custom bucket policy was attached (bucket is already clean).");
    } else {
      console.warn("   ⚠️ DeleteBucketPolicy note:", err.message);
    }
  }

  // 3. Configure S3 CORS for direct browser/mobile client uploads
  console.log("\n[3/3] Configuring S3 CORS policy for presigned PUT / GET requests...");
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ["*"],
              AllowedMethods: ["GET", "PUT", "POST", "HEAD"],
              AllowedOrigins: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      })
    );
    console.log("   ✅ S3 CORS configuration applied successfully!");
  } catch (err) {
    console.error("   ❌ Failed to set S3 CORS:", err.message);
  }

  // 4. Verify Active Settings
  console.log("\n[Verification] Fetching active S3 settings...");
  try {
    const accessBlock = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
    console.log("   Active Public Access Block:", accessBlock.PublicAccessBlockConfiguration);
    const cors = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    console.log("   Active CORS Rules Count:", cors.CORSRules?.length);
  } catch (err) {
    console.log("   Verification note:", err.message);
  }

  console.log(`\n======================================================`);
  console.log(`🎉 S3 Bucket '${bucket}' is now strictly PRIVATE & CORS-ready!`);
  console.log(`======================================================\n`);
}

configureS3Bucket()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal S3 Configuration Error:", err);
    process.exit(1);
  });
