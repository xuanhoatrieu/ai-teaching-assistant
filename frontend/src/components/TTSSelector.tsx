import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import './ModelSelector.css';

type Provider = 'GEMINI' | 'CLIPROXY' | 'VBEE' | 'VITTS' | string;
type ViTTSMode = 'auto' | 'clone' | 'design';

interface AvailableModel {
    name: string;
    displayName: string;
    description?: string;
    supportedTasks: string[];
    source?: string;
}

interface VoiceLibEntry {
    ref_id: string;
    name: string;
    language: string;
    ref_text?: string;
    duration_sec?: number;
}

interface DesignAttributes {
    gender: string[];
    age: string[];
    pitch: string[];
    style: string[];
    accent: string[];
}

interface ViTTSOptions {
    modes?: { id: string; name: string; description: string; params: string[] }[];
    voice_library?: VoiceLibEntry[];
    design_attributes?: DesignAttributes;
    defaults?: { speed: number; num_step: number; normalize: boolean };
    isPersonal?: boolean;
    error?: string;
}

interface TTSSelectorProps {
    onChange?: (config: {
        provider: string;
        model: string;
        voice: string;
        multilingualMode?: string;
        vittsMode?: string;
        vittsDesignInstruct?: string;
        vittsNormalize?: boolean;
    }) => void;
}

// Fallback attributes for the "System Voice" (design) form when the ViTTS
// options endpoint is unavailable (e.g. only system creds, or transient error).
const DEFAULT_DESIGN_ATTRIBUTES: DesignAttributes = {
    gender: ['male', 'female'],
    age: ['child', 'young', 'middle-aged', 'elderly'],
    pitch: ['very low', 'low', 'normal', 'high', 'very high'],
    style: ['normal', 'whisper'],
    accent: [],
};

export function TTSSelector({ onChange }: TTSSelectorProps) {
    const [provider, setProvider] = useState<Provider>('GEMINI');
    const [ttsModels, setTtsModels] = useState<AvailableModel[]>([]);
    const [voices, setVoices] = useState<AvailableModel[]>([]);
    const [selectedModel, setSelectedModel] = useState('');
    const [selectedVoice, setSelectedVoice] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    // ViTTS OmniVoice state
    const [vittsMode, setVittsMode] = useState<ViTTSMode>('auto');
    const [vittsOptions, setVittsOptions] = useState<ViTTSOptions | null>(null);
    const [vittsLoading, setVittsLoading] = useState(false);
    // Voice Design form
    const [designGender, setDesignGender] = useState('female');
    const [designAge, setDesignAge] = useState('young');
    const [designPitch, setDesignPitch] = useState('normal');
    const [designStyle, setDesignStyle] = useState('normal');
    const [designAccent, setDesignAccent] = useState('');
    const [vittsNormalize, setVittsNormalize] = useState(true); // SEA-G2P Normalize, default ON

    useEffect(() => {
        fetchModels();
    }, []);

    // Fetch ViTTS options when provider changes to VITTS
    useEffect(() => {
        if (provider === 'VITTS') {
            fetchViTTSOptions();
        }
    }, [provider]);

    const fetchViTTSOptions = async () => {
        try {
            setVittsLoading(true);
            const res = await api.get('/user/model-config/vitts-options');
            setVittsOptions(res.data);
        } catch (err) {
            console.error('Error fetching ViTTS options:', err);
            setVittsOptions(null);
        } finally {
            setVittsLoading(false);
        }
    };

    const fetchModels = async () => {
        try {
            setIsLoading(true);

            const modelsRes = await api.get('/user/model-config/discover');
            const geminiModels = modelsRes.data.models?.GEMINI || [];
            const cliproxyModels = modelsRes.data.models?.CLIPROXY || [];

            const geminiTTS = geminiModels
                .filter((m: AvailableModel) => m.supportedTasks.includes('TTS'))
                .map((m: AvailableModel) => ({ ...m, source: 'Gemini SDK' }));

            const cliproxyTTS = cliproxyModels
                .filter((m: AvailableModel) => m.supportedTasks.includes('TTS'))
                .map((m: AvailableModel) => ({ ...m, source: 'CLIProxy' }));

            const allTTSModels = [...cliproxyTTS, ...geminiTTS];

            // Discover Custom dynamic models
            Object.keys(modelsRes.data.models || {}).forEach(key => {
                if (['GEMINI', 'CLIPROXY', 'IMAGE_GEN', 'VITTS', 'VBEE'].includes(key)) return;
                
                const list = modelsRes.data.models[key] || [];
                const customTTS = list
                    .filter((m: AvailableModel) => m.supportedTasks.includes('TTS'))
                    .map((m: AvailableModel) => ({ ...m, source: key }));
                if (customTTS.length > 0) {
                    allTTSModels.push(...customTTS);
                }
            });

            setTtsModels(allTTSModels);

            const allVoices = geminiModels.filter((m: AvailableModel) =>
                m.supportedTasks.includes('TTS_VOICE') ||
                m.name.startsWith('vbee:') ||
                m.name.startsWith('vitts:') ||
                m.name.startsWith('custom_openai:')
            );

            // Also collect TTS_VOICE items from custom provider keys (e.g., PERSONAL)
            Object.keys(modelsRes.data.models || {}).forEach(key => {
                if (['GEMINI', 'CLIPROXY', 'IMAGE_GEN', 'VITTS', 'VBEE'].includes(key)) return;
                const list = modelsRes.data.models[key] || [];
                const customVoices = list
                    .filter((m: AvailableModel) => m.supportedTasks.includes('TTS_VOICE'))
                    .filter((m: AvailableModel) => !allVoices.some((v: AvailableModel) => v.name === m.name))
                    .map((m: AvailableModel) => ({ ...m, source: key }));
                if (customVoices.length > 0) {
                    allVoices.push(...customVoices);
                }
            });

            setVoices(allVoices);

            // Try to load saved TTS config
            try {
                const configRes = await api.get('/user/model-config');
                const configs = configRes.data?.configs || {};
                const defaults = configRes.data?.defaults || {};
                const ttsConfig = configs.TTS || defaults.TTS;

                if (ttsConfig && ttsConfig.modelName) {
                    const savedVoice = ttsConfig.modelName;
                    const currentProvider = ttsConfig.provider;

                    if (savedVoice.startsWith('vbee:')) {
                        setProvider('VBEE');
                        setSelectedVoice(savedVoice);
                    } else if (savedVoice.startsWith('vitts:')) {
                        setProvider('VITTS');
                        setSelectedVoice(savedVoice);
                        // Auto-detect mode
                        if (savedVoice.startsWith('vitts:ref:')) setVittsMode('clone');
                        else if (savedVoice === 'vitts:design') setVittsMode('design');
                        else if (savedVoice === 'vitts:auto') setVittsMode('auto');
                    } else if (savedVoice.startsWith('custom_openai:')) {
                        const parts = savedVoice.split(':');
                        const providerId = parts[1].toUpperCase();
                        setProvider(providerId);
                        setSelectedVoice(savedVoice);
                    } else if (savedVoice.startsWith('gemini-voice:')) {
                        setProvider(currentProvider || (cliproxyTTS.length > 0 ? 'CLIPROXY' : 'GEMINI'));
                        setSelectedVoice(savedVoice);
                    } else {
                        setProvider(currentProvider);
                        setSelectedVoice(savedVoice);
                    }

                    if (allTTSModels.length > 0) {
                        const providerPrefix = currentProvider === 'GEMINI' ? '' : 
                                               currentProvider === 'CLIPROXY' ? 'cliproxy:' : 
                                               `custom_openai:${currentProvider.toLowerCase()}:`;
                       
                        let matchedModel;
                        if (currentProvider === 'SHOPAIKEY' || (!['GEMINI', 'CLIPROXY', 'VBEE', 'VITTS'].includes(currentProvider))) {
                            // Determine model based on saved voice type
                            const isGeminiVoice = ['zephyr', 'puck', 'charon', 'kore', 'aoede'].some(name => savedVoice.toLowerCase().endsWith(':' + name.toLowerCase()));
                            const modelSuffix = isGeminiVoice ? 'gemini-tts' : 'tts-1';
                            matchedModel = allTTSModels.find(m => m.name === `custom_openai:${currentProvider.toLowerCase()}:${modelSuffix}`);
                        }
                        
                        if (!matchedModel) {
                            matchedModel = allTTSModels.find(m => 
                                providerPrefix === '' 
                                    ? (!m.name.startsWith('cliproxy:') && !m.name.startsWith('custom_openai:'))
                                    : m.name.startsWith(providerPrefix)
                            );
                        }
                        setSelectedModel(matchedModel?.name || allTTSModels[0].name);
                    }
                    return;
                }
            } catch (configErr) {
                console.log('No saved TTS config found, using defaults', configErr);
            }

            // Set defaults
            if (cliproxyTTS.length > 0) {
                setProvider('CLIPROXY');
                setSelectedModel(cliproxyTTS[0].name);
            } else if (geminiTTS.length > 0) {
                setProvider('GEMINI');
                setSelectedModel(geminiTTS[0].name);
            }

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

    // Build Voice Design instruct text from form fields
    // API expects exact items: "female, young adult, high pitch, whisper, american accent"
    const buildDesignInstruct = useCallback(() => {
        const parts: string[] = [];
        // Gender: "male" or "female" — exact match
        if (designGender) parts.push(designGender);
        // Age: map to valid API values
        const ageMap: Record<string, string> = { child: 'child', young: 'young adult', 'middle-aged': 'middle-aged', elderly: 'elderly' };
        if (designAge && ageMap[designAge]) parts.push(ageMap[designAge]);
        // Pitch: must include "pitch" suffix — "high pitch", "low pitch", etc. Skip "normal"
        const pitchMap: Record<string, string> = { 'very low': 'very low pitch', low: 'low pitch', normal: '', high: 'high pitch', 'very high': 'very high pitch' };
        if (designPitch && pitchMap[designPitch]) parts.push(pitchMap[designPitch]);
        // Style: "whisper" only (skip "normal")
        if (designStyle && designStyle !== 'normal') parts.push(designStyle);
        // Accent: already exact values like "american accent"
        if (designAccent) parts.push(designAccent);
        return parts.join(', ');
    }, [designGender, designAge, designPitch, designStyle, designAccent]);

    // Save TTS config
    const saveConfig = useCallback(async (currentProvider: Provider, model: string, voice: string, mode?: ViTTSMode) => {
        try {
            setIsSaving(true);
            setSaveStatus('idle');

            const payload: any = {
                taskType: 'TTS',
                provider: currentProvider,
            };

            const isCustom = !['GEMINI', 'CLIPROXY', 'VBEE', 'VITTS'].includes(currentProvider);

            // Voice logic handling
            if (currentProvider === 'VITTS') {
                if (mode === 'design') {
                    payload.modelName = 'vitts:design';
                    payload.voiceDesignInstruct = buildDesignInstruct();
                } else if (mode === 'clone') {
                    // voice is either "ref:UUID", "vitts:ref:UUID" or raw "UUID"
                    const refId = voice ? voice.replace('vitts:', '').replace('ref:', '') : '';
                    if (refId) {
                        payload.modelName = `vitts:ref:${refId}`;
                    } else {
                        payload.modelName = 'vitts:auto';
                    }
                } else {
                    payload.modelName = 'vitts:auto';
                }
            } else if (isCustom) {
                payload.modelName = voice;
            } else {
                payload.modelName = voice || (currentProvider === 'GEMINI' ? 'gemini-voice:Puck' : 'vbee:hn_female_thutrang_news_48k-fhg');
            }

            await api.post('/user/model-config/bulk', {
                configs: [payload]
            });

            setSaveStatus('success');
            setTimeout(() => setSaveStatus('idle'), 2000);

            // Notify parent
            if (onChange) {
                const voiceId = voice.includes(':') ? voice.split(':').slice(1).join(':') : voice;
                onChange({
                    provider: currentProvider,
                    model,
                    voice: voiceId,
                    vittsMode: currentProvider === 'VITTS' ? (mode || vittsMode) : undefined,
                    vittsDesignInstruct: currentProvider === 'VITTS' && (mode || vittsMode) === 'design' ? buildDesignInstruct() : undefined,
                    vittsNormalize: currentProvider === 'VITTS' ? vittsNormalize : undefined,
                });
            }
        } catch (err) {
            console.error('Error saving TTS config:', err);
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
        } finally {
            setIsSaving(false);
        }
    }, [onChange, vittsMode, vittsNormalize, buildDesignInstruct]);

    const handleProviderChange = (newProvider: Provider) => {
        setProvider(newProvider);
        let newVoice = '';
        let newModel = selectedModel;

        const isCustom = !['GEMINI', 'CLIPROXY', 'VBEE', 'VITTS'].includes(newProvider);

        if (newProvider === 'GEMINI' || newProvider === 'CLIPROXY') {
            const geminiVoices = voices.filter(v => v.name.startsWith('gemini-voice:'));
            newVoice = geminiVoices[0]?.name || '';
            if (newProvider === 'CLIPROXY') {
                const cliproxyTTS = ttsModels.filter(m => m.name.startsWith('cliproxy:'));
                newModel = cliproxyTTS[0]?.name || selectedModel;
            } else {
                const geminiTTS = ttsModels.filter(m => !m.name.startsWith('cliproxy:') && !m.name.startsWith('custom_openai:'));
                newModel = geminiTTS[0]?.name || selectedModel;
            }
        } else if (newProvider === 'VBEE') {
            const vbeeVoices = voices.filter(v => v.name.startsWith('vbee:'));
            newVoice = vbeeVoices[0]?.name || '';
            newModel = 'vbee-tts';
        } else if (newProvider === 'VITTS') {
            newVoice = 'vitts:auto';
            newModel = 'vitts';
        } else if (isCustom) {
            const customVoices = voices.filter(v => v.name.startsWith(`custom_openai:${newProvider.toLowerCase()}:`));
            const customModels = ttsModels.filter(m => m.name.startsWith(`custom_openai:${newProvider.toLowerCase()}:`));
            newModel = customModels[0]?.name || selectedModel;
            
            let availableVoices = customVoices;
            if (newProvider === 'SHOPAIKEY' || newProvider === 'PERSONAL') {
                const isGeminiModel = newModel.endsWith(':gemini-tts') || newModel.includes('gemini');
                const geminiNames = ['zephyr', 'puck', 'charon', 'kore', 'aoede'];
                availableVoices = customVoices.filter(v => {
                    const isGeminiVoice = geminiNames.some(name => v.name.toLowerCase().endsWith(':' + name.toLowerCase()));
                    return isGeminiModel ? isGeminiVoice : !isGeminiVoice;
                });
            }
            newVoice = availableVoices[0]?.name || '';
        }

        setSelectedVoice(newVoice);
        setSelectedModel(newModel);
        saveConfig(newProvider, newModel, newVoice);
    };

    const handleModelChange = (modelName: string) => {
        setSelectedModel(modelName);
        
        let newVoice = selectedVoice;
        if (provider === 'SHOPAIKEY' || provider === 'PERSONAL') {
            const isGeminiModel = modelName.endsWith(':gemini-tts') || modelName.includes('gemini');
            const geminiNames = ['zephyr', 'puck', 'charon', 'kore', 'aoede'];
            
            const customVoices = voices.filter(v => v.name.startsWith(`custom_openai:${provider.toLowerCase()}:`));
            const availableVoices = customVoices.filter(v => {
                const isGeminiVoice = geminiNames.some(name => v.name.toLowerCase().endsWith(':' + name.toLowerCase()));
                return isGeminiModel ? isGeminiVoice : !isGeminiVoice;
            });
            
            const isCurrentVoiceValid = availableVoices.some(v => v.name === selectedVoice);
            if (!isCurrentVoiceValid && availableVoices.length > 0) {
                newVoice = availableVoices[0].name;
                setSelectedVoice(newVoice);
            }
        }
        
        saveConfig(provider, modelName, newVoice);
    };

    const handleVoiceChange = (voiceName: string) => {
        setSelectedVoice(voiceName);
        saveConfig(provider, selectedModel, voiceName);
    };

    const handleVittsModeChange = (mode: ViTTSMode) => {
        setVittsMode(mode);
        // Clone requires a personal ViTTS key. Without it, switch the UI to clone
        // (to show the "chưa khai báo API" notice) but do NOT save a clone config.
        if (mode === 'clone' && !vittsOptions?.isPersonal) {
            return;
        }
        let voice = selectedVoice;
        if (mode === 'auto') voice = 'vitts:auto';
        else if (mode === 'design') voice = 'vitts:design';
        else if (mode === 'clone' && vittsOptions?.voice_library?.length) {
            voice = `vitts:ref:${vittsOptions.voice_library[0].ref_id}`;
        }
        setSelectedVoice(voice);
        saveConfig('VITTS', 'vitts', voice, mode);
    };

    const handleRefChange = (refId: string) => {
        const voice = `vitts:ref:${refId}`;
        setSelectedVoice(voice);
        saveConfig('VITTS', 'vitts', voice, 'clone');
    };

    const handleDesignChange = () => {
        // Re-save with updated design instruct
        saveConfig('VITTS', 'vitts', 'vitts:design', 'design');
    };


    const getFilteredVoices = () => {
        if (provider === 'GEMINI' || provider === 'CLIPROXY') {
            return voices.filter(v => v.name.startsWith('gemini-voice:'));
        }
        if (provider === 'VBEE') {
            return voices.filter(v => v.name.startsWith('vbee:'));
        }
        if (provider === 'VITTS') {
            return voices.filter(v => v.name.startsWith('vitts:'));
        }
        
        const allCustomVoices = voices.filter(v => v.name.startsWith(`custom_openai:${provider.toLowerCase()}:`));
        if (provider === 'SHOPAIKEY' || provider === 'PERSONAL') {
            const isGeminiModel = selectedModel.endsWith(':gemini-tts') || selectedModel.includes('gemini');
            const geminiNames = ['zephyr', 'puck', 'charon', 'kore', 'aoede'];
            
            return allCustomVoices.filter(v => {
                const isGeminiVoice = geminiNames.some(name => v.name.toLowerCase().endsWith(':' + name.toLowerCase()));
                return isGeminiModel ? isGeminiVoice : !isGeminiVoice;
            });
        }
        return allCustomVoices;
    };

    const filteredVoices = getFilteredVoices();

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
                        className={`provider-btn ${(provider === 'GEMINI' || provider === 'CLIPROXY') ? 'active' : ''}`}
                        onClick={() => handleProviderChange(ttsModels.some(m => m.name.startsWith('cliproxy:')) ? 'CLIPROXY' : 'GEMINI')}
                        disabled={isSaving}
                    >
                        {ttsModels.some(m => m.name.startsWith('cliproxy:')) ? '🌐 Gemini AI (CLIProxy)' : '🌟 Gemini AI'}
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
                    {Array.from(new Set(
                        ttsModels
                            .filter(m => m.source && !['Gemini SDK', 'CLIProxy'].includes(m.source))
                            .map(m => m.source as string)
                    )).map((cp) => (
                        <button
                            key={cp}
                            className={`provider-btn ${provider === cp ? 'active' : ''}`}
                            onClick={() => handleProviderChange(cp)}
                            disabled={isSaving}
                        >
                            ⚡ {cp}
                        </button>
                    ))}
                </div>
                {saveStatus === 'success' && <span className="save-status success">✓ Đã lưu</span>}
                {saveStatus === 'error' && <span className="save-status error">✗ Lỗi lưu</span>}
                {isSaving && <span className="save-status saving">⏳</span>}
            </div>

            {/* Model Selection */}
            {(provider === 'GEMINI' || provider === 'CLIPROXY' || !['VBEE', 'VITTS'].includes(provider)) && ttsModels.length > 0 && (
                <div className="tts-row">
                    <label className="tts-label">🔧 Model:</label>
                    <select
                        className="tts-select"
                        value={selectedModel}
                        onChange={(e) => handleModelChange(e.target.value)}
                        disabled={isSaving}
                    >
                        {ttsModels
                            .filter(model => {
                                if (provider === 'GEMINI') return model.source === 'Gemini SDK';
                                if (provider === 'CLIPROXY') return model.source === 'CLIProxy';
                                return model.source === provider;
                            })
                            .map((model) => (
                                <option key={model.name} value={model.name}>
                                    [{model.source}] {model.displayName}
                                </option>
                            ))}
                    </select>
                </div>
            )}

            {/* Gemini/Vbee Voice Selection */}
            {provider !== 'VITTS' && (
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
            )}

            {/* ═══════════════════════════════════════════════════════ */}
            {/* ViTTS OmniVoice Controls */}
            {/* ═══════════════════════════════════════════════════════ */}
            {provider === 'VITTS' && (
                <div className="vitts-omnivoice">
                    {vittsLoading ? (
                        <div className="tts-loading">⏳ Đang tải ViTTS options...</div>
                    ) : (
                        <>
                            {/* Mode Selector: Auto / System Voice / Voice Clone */}
                            <div className="tts-row">
                                <label className="tts-label">🎛️ Chế độ:</label>
                                <div className="provider-buttons vitts-mode-buttons">
                                    <button
                                        className={`provider-btn ${vittsMode === 'auto' ? 'active' : ''}`}
                                        onClick={() => handleVittsModeChange('auto')}
                                        disabled={isSaving}
                                        title="Model tự chọn giọng phù hợp"
                                    >
                                        🤖 Tự động
                                    </button>
                                    <button
                                        className={`provider-btn ${vittsMode === 'design' ? 'active' : ''}`}
                                        onClick={() => handleVittsModeChange('design')}
                                        disabled={isSaving}
                                        title="Chọn giọng hệ thống theo giới tính và thuộc tính"
                                    >
                                        🗣️ Giọng hệ thống
                                    </button>
                                    <button
                                        className={`provider-btn ${vittsMode === 'clone' ? 'active' : ''}`}
                                        onClick={() => handleVittsModeChange('clone')}
                                        disabled={isSaving}
                                        title="Clone giọng từ giọng mẫu cá nhân"
                                    >
                                        🎤 Giọng clone
                                    </button>
                                </div>
                            </div>

                            {/* Mode: System Voice — attribute dropdowns (gender/age/pitch/...) */}
                            {vittsMode === 'design' && (() => {
                                const attrs = vittsOptions?.design_attributes || DEFAULT_DESIGN_ATTRIBUTES;
                                return (
                                <div className="vitts-design-form">
                                    <div className="tts-row">
                                        <label className="tts-label">👤 Giới tính:</label>
                                        <select className="tts-select" value={designGender}
                                            onChange={(e) => { setDesignGender(e.target.value); }}
                                        >
                                            {attrs.gender.map(g => (
                                                <option key={g} value={g}>{g === 'male' ? '👨 Nam' : '👩 Nữ'}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="tts-row">
                                        <label className="tts-label">🎂 Độ tuổi:</label>
                                        <select className="tts-select" value={designAge}
                                            onChange={(e) => { setDesignAge(e.target.value); }}
                                        >
                                            {attrs.age.map(a => (
                                                <option key={a} value={a}>
                                                    {a === 'child' ? '👶 Trẻ em' : a === 'young' ? '🧑 Trẻ' : a === 'middle-aged' ? '🧔 Trung niên' : '👴 Lớn tuổi'}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="tts-row">
                                        <label className="tts-label">🎵 Cao độ:</label>
                                        <select className="tts-select" value={designPitch}
                                            onChange={(e) => { setDesignPitch(e.target.value); }}
                                        >
                                            {attrs.pitch.map(p => (
                                                <option key={p} value={p}>{p}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="tts-row">
                                        <label className="tts-label">💬 Phong cách:</label>
                                        <select className="tts-select" value={designStyle}
                                            onChange={(e) => { setDesignStyle(e.target.value); }}
                                        >
                                            {attrs.style.map(s => (
                                                <option key={s} value={s}>{s === 'whisper' ? '🤫 Thì thầm' : '🗣️ Bình thường'}</option>
                                            ))}
                                        </select>
                                    </div>
                                    {attrs.accent.filter(a => a).length > 0 && (
                                        <div className="tts-row">
                                            <label className="tts-label">🌍 Giọng vùng:</label>
                                            <select className="tts-select" value={designAccent}
                                                onChange={(e) => { setDesignAccent(e.target.value); }}
                                            >
                                                <option value="">Không có</option>
                                                {attrs.accent.filter(a => a).map(a => (
                                                    <option key={a} value={a}>{a}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    <div className="vitts-design-preview">
                                        💡 Instruct: <em>{buildDesignInstruct()}</em>
                                    </div>
                                    <button className="btn-apply-design" onClick={handleDesignChange} disabled={isSaving}>
                                        ✅ Áp dụng
                                    </button>
                                </div>
                                );
                            })()}

                            {/* Mode: Voice Clone — requires personal ViTTS API key */}
                            {vittsMode === 'clone' && (
                                !vittsOptions?.isPersonal ? (
                                    <div className="tts-note" style={{ padding: '0.6rem 0.85rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', fontSize: '0.85rem', lineHeight: 1.5 }}>
                                        ⚠️ Giọng clone yêu cầu <strong>API key ViTTS cá nhân</strong> (giọng mẫu nằm trên tài khoản ViTTS của bạn).
                                        Bạn chưa khai báo API key cá nhân — vui lòng thêm trong <strong>Cài đặt → API Keys → ViTTS</strong>, hoặc chọn chế độ khác.
                                    </div>
                                ) : (
                                    <div className="tts-row">
                                        <label className="tts-label">📎 Giọng mẫu:</label>
                                        <select
                                            className="tts-select voice-select"
                                            value={selectedVoice.replace('vitts:ref:', '')}
                                            onChange={(e) => handleRefChange(e.target.value)}
                                            disabled={isSaving}
                                        >
                                            {!vittsOptions?.voice_library?.length ? (
                                                <option value="">-- Chưa có giọng mẫu --</option>
                                            ) : (
                                                vittsOptions.voice_library.map((ref) => (
                                                    <option key={ref.ref_id} value={ref.ref_id}>
                                                        {ref.name} ({ref.language}) {ref.duration_sec ? `• ${ref.duration_sec.toFixed(1)}s` : ''}
                                                    </option>
                                                ))
                                            )}
                                        </select>
                                    </div>
                                )
                            )}

                            {/* Mode: Auto — no extra controls needed */}
                            {vittsMode === 'auto' && (
                                <div className="tts-info">
                                    🤖 Model sẽ tự động chọn giọng phù hợp nhất cho nội dung
                                </div>
                            )}

                            {/* SEA-G2P Normalize toggle — visible in all modes */}
                            <div className="tts-row vitts-normalize-row">
                                <label className="vitts-normalize-label">
                                    <input
                                        type="checkbox"
                                        checked={vittsNormalize}
                                        onChange={(e) => {
                                            setVittsNormalize(e.target.checked);
                                            saveConfig('VITTS', 'vitts', selectedVoice, vittsMode);
                                        }}
                                        disabled={isSaving}
                                    />
                                    <span className="normalize-checkbox-icon">{vittsNormalize ? '☑️' : '☐'}</span>
                                    SEA-G2P Normalize
                                </label>
                                <span className="normalize-hint">
                                    Chuẩn hóa phát âm tiếng Việt (khuyến nghị bật)
                                </span>
                            </div>
                        </>
                    )}
                </div>
            )}


            {/* Info text */}
            <div className="tts-info">
                💡 Chọn nhà cung cấp và giọng đọc, sau đó nhấn "Tạo Audio" cho từng slide
            </div>
        </div>
    );
}
