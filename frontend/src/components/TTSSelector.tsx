import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import './ModelSelector.css';

type Provider = 'GEMINI' | 'VBEE' | 'VITTS';

interface AvailableModel {
    name: string;
    displayName: string;
    description?: string;
    supportedTasks: string[];
}

interface TTSSelectorProps {
    onChange?: (config: { provider: string; model: string; voice: string; multilingualMode?: string }) => void;
}

export function TTSSelector({ onChange }: TTSSelectorProps) {
    const [provider, setProvider] = useState<Provider>('GEMINI');
    const [ttsModels, setTtsModels] = useState<AvailableModel[]>([]);
    const [voices, setVoices] = useState<AvailableModel[]>([]);
    const [selectedModel, setSelectedModel] = useState('');
    const [selectedVoice, setSelectedVoice] = useState('');
    const [multilingualMode, setMultilingualMode] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        fetchModels();
    }, []);

    const fetchModels = async () => {
        try {
            setIsLoading(true);

            // Fetch available models and voices
            const modelsRes = await api.get('/user/model-config/discover');
            const allModels = modelsRes.data.models?.GEMINI || [];

            // Filter TTS models (gemini-2.5-*-tts)
            const models = allModels.filter((m: AvailableModel) =>
                m.supportedTasks.includes('TTS')
            );
            setTtsModels(models);

            // Filter voices - both Gemini and Vbee
            const allVoices = allModels.filter((m: AvailableModel) =>
                m.supportedTasks.includes('TTS_VOICE')
            );
            setVoices(allVoices);

            // Try to load saved TTS config from backend
            try {
                const configRes = await api.get('/user/model-config');
                const savedConfigs = configRes.data || [];
                const ttsConfig = savedConfigs.find((c: any) => c.taskType === 'TTS');

                if (ttsConfig && ttsConfig.modelName) {
                    // Parse saved voice format: "gemini-voice:VoiceName" or "vbee:voiceId"
                    const savedVoice = ttsConfig.modelName;

                    if (savedVoice.startsWith('vbee:')) {
                        setProvider('VBEE');
                        setSelectedVoice(savedVoice);
                    } else if (savedVoice.startsWith('gemini-voice:')) {
                        setProvider('GEMINI');
                        setSelectedVoice(savedVoice);
                    }

                    // Set model for Gemini
                    if (models.length > 0) {
                        setSelectedModel(models[0].name);
                    }
                    return; // Use saved config, don't set defaults
                }
            } catch (configErr) {
                console.log('No saved TTS config found, using defaults');
            }

            // Set defaults only if no saved config
            if (models.length > 0) {
                setSelectedModel(models[0].name);
            }

            // Default to Puck voice for Gemini
            const defaultVoice = allVoices.find((v: AvailableModel) => v.name.includes('Puck'));
            if (defaultVoice) {
                setSelectedVoice(defaultVoice.name);
            } else if (allVoices.length > 0) {
                setSelectedVoice(allVoices[0].name);
            }
        } catch (err) {
            console.error('Error fetching TTS config:', err);
        } finally {
            setIsLoading(false);
        }
    };

    // Auto-save TTS config when selection changes
    const saveConfig = useCallback(async (currentProvider: Provider, model: string, voice: string) => {
        try {
            setIsSaving(true);
            setSaveStatus('idle');

            // For TTS, we save the VOICE as modelName since that's what determines the audio
            // Format: "gemini-voice:Puck" or "vbee:voice_id"
            // The actual TTS model is derived from provider
            const modelNameToSave = voice || (currentProvider === 'GEMINI' ? 'gemini-voice:Puck' : 'vbee:hn_female_thutrang_news_48k-fhg');

            // Save model config for TTS task
            await api.post('/user/model-config/bulk', {
                configs: [{
                    taskType: 'TTS',
                    provider: currentProvider,
                    modelName: modelNameToSave,  // Save voice as modelName
                }]
            });

            setSaveStatus('success');
            setTimeout(() => setSaveStatus('idle'), 2000);

            // Extract voice ID for callback
            const voiceId = voice.includes(':') ? voice.split(':')[1] : voice;

            // Notify parent if callback provided
            if (onChange) {
                onChange({ provider: currentProvider, model, voice: voiceId });
            }
        } catch (err) {
            console.error('Error saving TTS config:', err);
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
        } finally {
            setIsSaving(false);
        }
    }, [onChange]);

    const handleProviderChange = (newProvider: Provider) => {
        setProvider(newProvider);
        // Reset voice selection when provider changes
        let newVoice = '';
        let newModel = selectedModel;

        if (newProvider === 'GEMINI') {
            const geminiVoices = voices.filter(v => v.name.startsWith('gemini-voice:'));
            newVoice = geminiVoices[0]?.name || '';
        } else if (newProvider === 'VBEE') {
            const vbeeVoices = voices.filter(v => v.name.startsWith('vbee:'));
            newVoice = vbeeVoices[0]?.name || '';
            newModel = 'vbee-tts';
        } else if (newProvider === 'VITTS') {
            const vittsVoices = voices.filter(v => v.name.startsWith('vitts:'));
            newVoice = vittsVoices[0]?.name || 'vitts:male';
            newModel = 'vitts';
        }

        setSelectedVoice(newVoice);
        saveConfig(newProvider, newModel, newVoice);
    };

    const handleModelChange = (modelName: string) => {
        setSelectedModel(modelName);
        saveConfig(provider, modelName, selectedVoice);
    };

    const handleVoiceChange = (voiceName: string) => {
        setSelectedVoice(voiceName);
        saveConfig(provider, selectedModel, voiceName);
    };

    const filteredVoices = provider === 'GEMINI'
        ? voices.filter(v => v.name.startsWith('gemini-voice:'))
        : provider === 'VBEE'
            ? voices.filter(v => v.name.startsWith('vbee:'))
            : voices.filter(v => v.name.startsWith('vitts:'));

    if (isLoading) {
        return (
            <div className="tts-selector">
                <div className="tts-loading">⏳ Đang tải cấu hình TTS...</div>
            </div>
        );
    }

    return (
        <div className="tts-selector">
            {/* Provider Selection */}
            <div className="tts-row">
                <label className="tts-label">🎙️ Nhà cung cấp:</label>
                <div className="provider-buttons">
                    <button
                        className={`provider-btn ${provider === 'GEMINI' ? 'active' : ''}`}
                        onClick={() => handleProviderChange('GEMINI')}
                        disabled={isSaving}
                    >
                        🌟 Gemini AI
                    </button>
                    <button
                        className={`provider-btn ${provider === 'VBEE' ? 'active' : ''}`}
                        onClick={() => handleProviderChange('VBEE')}
                        disabled={isSaving}
                    >
                        🇻🇳 Vbee TTS
                    </button>
                    <button
                        className={`provider-btn ${provider === 'VITTS' ? 'active' : ''}`}
                        onClick={() => handleProviderChange('VITTS')}
                        disabled={isSaving}
                    >
                        🎙️ ViTTS Local
                    </button>
                </div>
                {saveStatus === 'success' && <span className="save-status success">✓ Đã lưu</span>}
                {saveStatus === 'error' && <span className="save-status error">✗ Lỗi lưu</span>}
                {isSaving && <span className="save-status saving">⏳</span>}
            </div>

            {/* Model Selection (Gemini only) */}
            {provider === 'GEMINI' && ttsModels.length > 0 && (
                <div className="tts-row">
                    <label className="tts-label">🔧 Model:</label>
                    <select
                        className="tts-select"
                        value={selectedModel}
                        onChange={(e) => handleModelChange(e.target.value)}
                        disabled={isSaving}
                    >
                        {ttsModels.map((model) => (
                            <option key={model.name} value={model.name}>
                                {model.displayName}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* Voice Selection */}
            <div className="tts-row">
                <label className="tts-label">🎤 Giọng đọc:</label>
                <select
                    className="tts-select voice-select"
                    value={selectedVoice}
                    onChange={(e) => handleVoiceChange(e.target.value)}
                    disabled={isSaving}
                >
                    {filteredVoices.length === 0 ? (
                        <option value="">-- Không có giọng đọc --</option>
                    ) : (
                        filteredVoices.map((voice) => (
                            <option key={voice.name} value={voice.name}>
                                {voice.displayName}
                            </option>
                        ))
                    )}
                </select>
            </div>

            {/* Multilingual Mode (ViTTS only) */}
            {provider === 'VITTS' && (
                <div className="tts-row">
                    <label className="tts-label">🌐 Đa ngôn ngữ:</label>
                    <select
                        className="tts-select"
                        value={multilingualMode}
                        onChange={(e) => {
                            setMultilingualMode(e.target.value);
                            if (onChange) {
                                onChange({ provider, model: selectedModel, voice: selectedVoice, multilingualMode: e.target.value || undefined });
                            }
                        }}
                        disabled={isSaving}
                    >
                        <option value="">Không sử dụng</option>
                        <option value="auto">🔄 Tự động (auto)</option>
                        <option value="syllable">🔤 Âm tiết (syllable)</option>
                        <option value="english">🇬🇧 Tiếng Anh (english)</option>
                    </select>
                </div>
            )}

            {/* Info text */}
            <div className="tts-info">
                💡 Chọn nhà cung cấp và giọng đọc, sau đó nhấn "Tạo Audio" cho từng slide
            </div>
        </div>
    );
}
