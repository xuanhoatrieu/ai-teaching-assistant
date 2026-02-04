import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

// Load .env file
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

console.log('=== Gemini Image Generation Test ===');
console.log(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}... (${apiKey.length} chars)` : 'NOT SET'}`);

if (!apiKey) {
    console.error('GEMINI_API_KEY not found in environment');
    process.exit(1);
}

async function testImageGeneration() {
    try {
        console.log('Initializing GoogleGenAI client...');
        const client = new GoogleGenAI({ apiKey });

        // CORRECT model name: gemini-2.5-flash-image (not preview-generation)
        const model = 'gemini-2.5-flash-image';
        console.log(`Calling generateContentStream with model: ${model}`);

        const response = await client.models.generateContentStream({
            model,
            contents: [{
                role: 'user',
                parts: [{ text: 'Generate a simple blue circle on white background' }],
            }],
            config: {
                responseModalities: ['IMAGE', 'TEXT'],
            },
        });

        console.log('Processing stream response...');

        for await (const chunk of response) {
            console.log('Received chunk:', JSON.stringify(chunk, null, 2).substring(0, 500));

            if (chunk.candidates?.[0]?.content?.parts) {
                for (const part of chunk.candidates[0].content.parts) {
                    if (part.inlineData) {
                        console.log('✅ SUCCESS! Image generated!');
                        console.log(`  MimeType: ${part.inlineData.mimeType}`);
                        console.log(`  Data length: ${part.inlineData.data?.length || 0} chars`);
                        return;
                    }
                    if (part.text) {
                        console.log(`  Text: ${part.text}`);
                    }
                }
            }
        }

        console.log('❌ No image data found in response');

    } catch (error: any) {
        console.error('❌ Error:', error.message || error);
        console.error('Status:', error.status);
    }
}

testImageGeneration();
