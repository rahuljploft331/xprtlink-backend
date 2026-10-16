-- Add 'stripe' as a valid subscription store for web Stripe Checkout subscriptions.
-- PostgreSQL requires ALTER TYPE ... ADD VALUE outside a transaction, so this must
-- run as a raw DDL statement. Prisma's migrate deploy handles this correctly.
ALTER TYPE "subscription_store" ADD VALUE IF NOT EXISTS 'stripe';
