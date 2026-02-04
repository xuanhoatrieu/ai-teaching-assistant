-- Seed TTS providers data
INSERT INTO tts_providers (id, name, type, endpoint, required_fields, is_system, is_active, created_at) VALUES
(gen_random_uuid(), 'Gemini TTS', 'GEMINI', NULL, ARRAY['api_key'], true, true, NOW()),
(gen_random_uuid(), 'Google Cloud TTS', 'GOOGLE_CLOUD', NULL, ARRAY['project_id', 'credentials_json'], true, true, NOW()),
(gen_random_uuid(), 'Vbee TTS', 'VBEE', 'https://vbee.vn/api/v1/tts', ARRAY['token', 'app_id'], false, true, NOW())
ON CONFLICT DO NOTHING;
