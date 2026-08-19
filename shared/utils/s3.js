import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let s3ClientInstance = null;

export function getS3Client() {
  if (s3ClientInstance) return s3ClientInstance;

  const region = process.env.AWS_REGION || "us-west-2";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (accessKeyId && secretAccessKey) {
    s3ClientInstance = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  } else {
    // Default / IAM Role / Fallback
    s3ClientInstance = new S3Client({ region });
  }

  return s3ClientInstance;
}

export function getS3BucketName() {
  return process.env.S3_BUCKET || "xprtlink-static";
}

/**
 * Generate a Presigned PUT URL for client upload to S3 (temporary folder).
 * @param {string} key - e.g. "temp/<userId>/<assetId>/<filename>"
 * @param {string} mimeType
 * @param {number} [expiresIn=900] - 15 minutes
 */
export async function generatePresignedUploadUrl(key, mimeType, expiresIn = 900) {
  const client = getS3Client();
  const bucket = getS3BucketName();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mimeType,
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Generate a Presigned GET URL for securely viewing private S3 objects.
 * @param {string} key - S3 object key
 * @param {number} [expiresIn=86400] - 24 hours
 */
export async function generatePresignedDownloadUrl(key, expiresIn = 86400) {
  if (!key) return null;

  try {
    const client = getS3Client();
    const bucket = getS3BucketName();

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return await getSignedUrl(client, command, { expiresIn });
  } catch (err) {
    console.error("[S3] generatePresignedDownloadUrl error:", err.message);
    return null;
  }
}

/**
 * Direct upload buffer to S3 (e.g. for base64 / test client fallback).
 * @param {string} key
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
export async function uploadBufferToS3(key, buffer, mimeType) {
  const client = getS3Client();
  const bucket = getS3BucketName();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  });

  await client.send(command);
  return { bucket, key };
}

/**
 * Move S3 object from temporary path to permanent path.
 * @param {string} sourceKey - e.g. "temp/..."
 * @param {string} destinationKey - e.g. "<userId>/image/<assetId>_file.png"
 */
export async function moveS3Object(sourceKey, destinationKey) {
  if (sourceKey === destinationKey) return;

  const client = getS3Client();
  const bucket = getS3BucketName();

  try {
    // 1. Copy object to permanent location
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${encodeURIComponent(sourceKey)}`,
        Key: destinationKey,
      })
    );

    // 2. Delete original temporary object
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: sourceKey,
      })
    );

    console.log(`[S3] Moved object from '${sourceKey}' to '${destinationKey}'`);
  } catch (err) {
    console.error(`[S3] moveS3Object failed (${sourceKey} -> ${destinationKey}):`, err.message);
    // If copy failed, throw or log
    throw err;
  }
}
