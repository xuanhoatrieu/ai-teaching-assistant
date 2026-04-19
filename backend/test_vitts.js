// Test OmniVoice clone-ref with same URLSearchParams approach as provider
const axios = require('axios');

const BASE = 'http://117.0.36.6:8888';
const KEY = 'vneu_JkM0WjE3oTeK3pNq4EQM2hSzV98S_WboFZB5wzrPNZE';
const REF_ID = 'c8495f76-c047-47e1-8a77-1cb651bb6511';
const TEXT = 'Chúng ta bắt đầu với chủ đề hôm nay.';

async function testClone() {
    console.log('=== Test Clone-Ref ===');
    const formData = new URLSearchParams();
    formData.append('text', TEXT);
    formData.append('ref_id', REF_ID);
    formData.append('speed', '1');
    formData.append('num_step', '32');
    formData.append('normalize', 'true');
    console.log('Body:', formData.toString());
    try {
        const resp = await axios.post(BASE+'/api/v1/omnivoice/generate-clone-ref', formData.toString(), {
            headers: { 'X-API-Key': KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000
        });
        console.log('Clone OK:', JSON.stringify(resp.data));
    } catch (e) { console.log('Clone ERR:', e.response?.status, JSON.stringify(e.response?.data)); }
}

async function testDesign() {
    console.log('\n=== Test Design ===');
    try {
        const resp = await axios.post(BASE+'/api/v1/omnivoice/generate-design', 
            { text: TEXT, instruct: 'female, young adult', speed: 1.0, num_step: 32, normalize: true },
            { headers: { 'X-API-Key': KEY }, timeout: 30000 });
        console.log('Design OK:', JSON.stringify(resp.data));
    } catch (e) { console.log('Design ERR:', e.response?.status, JSON.stringify(e.response?.data)); }
}

async function testAuto() {
    console.log('\n=== Test Auto ===');
    try {
        const resp = await axios.post(BASE+'/api/v1/omnivoice/generate-auto', 
            { text: TEXT, speed: 1.0, num_step: 32, normalize: true },
            { headers: { 'X-API-Key': KEY }, timeout: 30000 });
        console.log('Auto OK:', JSON.stringify(resp.data));
    } catch (e) { console.log('Auto ERR:', e.response?.status, JSON.stringify(e.response?.data)); }
}

testClone().then(() => testDesign()).then(() => testAuto());
