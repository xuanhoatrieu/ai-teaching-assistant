-- CLIProxy Integration Migration
-- Run this on your PostgreSQL database

-- Add CLIPROXY to APIService enum
ALTER TYPE "APIService" ADD VALUE IF NOT EXISTS 'CLIPROXY';

-- Create system_configs table
CREATE TABLE IF NOT EXISTS "system_configs" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    
    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- Create unique index on key
CREATE UNIQUE INDEX IF NOT EXISTS "system_configs_key_key" ON "system_configs"("key");

-- Insert default CLIProxy config
INSERT INTO "system_configs" ("id", "key", "value", "updated_at") VALUES
  (gen_random_uuid()::text, 'cliproxy.enabled', 'true', NOW()),
  (gen_random_uuid()::text, 'cliproxy.url', 'https://cliproxy.hoclieu.id.vn', NOW()),
  (gen_random_uuid()::text, 'cliproxy.apiKey', 'ai-teaching-assistant-prod', NOW()),
  (gen_random_uuid()::text, 'cliproxy.defaultTextModel', 'gemini-2.5-flash', NOW()),
  (gen_random_uuid()::text, 'cliproxy.defaultImageModel', 'gemini-3-pro-image-preview', NOW())
ON CONFLICT (key) DO NOTHING;
