import requests
import json

url = "http://192.168.0.11:8888/api/v1/tts/synthesize"
headers = {"X-API-Key": "ai-teaching-assistant-prod"} # Assuming this is the key? Wait, I don't know the vitts key.
payload = {"text": "Xin chào", "voice_id": "vitts:male", "speed": 1.0, "nfe_step": 32, "cfg_strength": 2.0}

try:
    with open('/home/trieuhoa/ai-teaching-assistant/backend/.env', 'r') as f:
        for line in f:
            if 'CLIPROXY_API_KEY' in line:
                headers['X-API-Key'] = line.split('=')[1].strip()
except Exception:
    pass

response = requests.post(url, json=payload, headers=headers)
print("Status:", response.status_code)
print("Headers:", response.headers)
print("Content len:", len(response.content))
if len(response.content) < 1000:
    print("Content:", response.text)
