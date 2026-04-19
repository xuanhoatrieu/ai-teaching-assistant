-- Migration: Add language field to subjects table
-- This allows users to choose output language per subject/course
-- Values: 'vi' (Vietnamese default), 'en' (English), 'vi-en' (Bilingual: slides EN, speaker notes VI)

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'vi' NOT NULL;

-- All existing subjects default to Vietnamese (backward compatible)
UPDATE subjects SET language = 'vi' WHERE language IS NULL;
