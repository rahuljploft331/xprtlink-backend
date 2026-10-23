-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('starting', 'active', 'stopped', 'failed');

-- CreateTable
CREATE TABLE "consultation_transcripts" (
    "id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "task_id" VARCHAR(128),
    "status" "TranscriptStatus" NOT NULL DEFAULT 'starting',
    "vendor" VARCHAR(64),
    "started_at" TIMESTAMPTZ(6),
    "stopped_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(64),
    "last_error_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

CONSTRAINT "consultation_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_transcript_segments" (
    "id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "stream_id" VARCHAR(256) NOT NULL DEFAULT '',
    "sentence_id" VARCHAR(128) NOT NULL DEFAULT '',
    "zego_user_id" VARCHAR(128),
    "speaker_role" VARCHAR(16) NOT NULL DEFAULT 'unknown',
    "text" TEXT NOT NULL,
    "language" VARCHAR(32),
    "is_final" BOOLEAN NOT NULL DEFAULT true,
    "zego_timestamp_ms" BIGINT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "raw" JSONB NOT NULL DEFAULT '{}',

CONSTRAINT "consultation_transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consultation_transcripts_consultation_id_key" ON "consultation_transcripts"("consultation_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_transcripts_task_id_key" ON "consultation_transcripts"("task_id");

-- CreateIndex
CREATE INDEX "consultation_transcript_segments_transcript_id_zego_timesta_idx" ON "consultation_transcript_segments"("transcript_id", "zego_timestamp_ms");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_transcript_segments_transcript_id_stream_id_se_key" ON "consultation_transcript_segments"("transcript_id", "stream_id", "sentence_id");

-- AddForeignKey
ALTER TABLE "consultation_transcripts" ADD CONSTRAINT "consultation_transcripts_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_transcript_segments" ADD CONSTRAINT "consultation_transcript_segments_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "consultation_transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
