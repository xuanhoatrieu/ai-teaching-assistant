import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import './ModelSelector.css';

type Provider = 'GEMINI' | 'CLIPROXY' | 'VBEE' | 'VITTS';
type ViTTSMode = 'auto' | 'clone' | 'design';

interface AvailableModel {
    name: string;
    displayName: string;
    description?: string;
    supportedTasks: string[];
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
            setTtsModels(allTTSModels);

            const allVoices = geminiModels.filter((m: AvailableModel) =>
                m.supportedTasks.includes('TTS_VOICE')
            );
            setVoices(allVoices);

            // Try to load saved TTS config
            try {
                const configRes = await api.get('/user/model-config');
                const savedConfigs = configRes.data || [];
                const ttsConfig = savedConfigs.find((c: any) => c.taskType === 'TTS');

                if (ttsConfig && ttsConfig.modelName) {
                    const savedVoice = ttsConfig.modelName;

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
                    } else if (savedVoice.startsWith('gemini-voice:')) {
                        setProvider(cliproxyTTS.length > 0 ? 'CLIPROXY' : 'GEMINI');
                        setSelectedVoice(savedVoice);
                    }

                    if (allTTSModels.length > 0) {
                        setSelectedModel(allTTSModels[0].name);
                    }
                    return;
                }
            } catch (configErr) {
                console.log('No saved TTS config found, using defaults');
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

            let modelNameToSave = voice || (currentProvider === 'GEMINI' ? 'gemini-voice:Puck' : 'vbee:hn_female_thutrang_news_48k-fhg');

            // For ViTTS, encode mode in modelName
            if (currentProvider === 'VITTS') {
                const m = mode || vittsMode;
                if (m === 'auto') modelNameToSave = 'vitts:auto';
                else if (m === 'design') modelNameToSave = 'vitts:design';
                // clone mode: keep the voice (vitts:ref:UUID)
            }

            await api.post('/user/model-config/bulk', {
                configs: [{
                    taskType: 'TTS',
                    provider: currentProvider,
                    modelName: modelNameToSave,
                }]
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

        if (newProvider === 'GEMINI' || newProvider === 'CLIPROXY') {
            const geminiVoices = voices.filter(v => v.name.startsWith('gemini-voice:'));
            newVoice = geminiVoices[0]?.name || '';
            if (newProvider === 'CLIPROXY') {
                const cliproxyTTS = ttsModels.filter(m => m.name.startsWith('cliproxy:'));
                newModel = cliproxyTTS[0]?.name || selectedModel;
            } else {
                const geminiTTS = ttsModels.filter(m => !m.name.startsWith('cliproxy:'));
                newModel = geminiTTS[0]?.name || selectedModel;
            }
        } else if (newProvider === 'VBEE') {
            const vbeeVoices = voices.filter(v => v.name.startsWith('vbee:'));
            newVoice = vbeeVoices[0]?.name || '';
            newModel = 'vbee-tts';
        } else if (newProvider === 'VITTS') {
            newVoice = 'vitts:auto';
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

    const handleVittsModeChange = (mode: ViTTSMode) => {
        setVittsMode(mode);
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

    const filteredVoices = (provider === 'GEMINI' || provider === 'CLIPROXY')
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
                </div>
                {saveStatus === 'success' && <span className="save-status success">✓ Đã lưu</span>}
                {saveStatus === 'error' && <span className="save-status error">✗ Lỗi lưu</span>}
                {isSaving && <span className="save-status saving">⏳</span>}
            </div>

            {/* Model Selection (Gemini only) */}
            {(provider === 'GEMINI' || provider === 'CLIPROXY') && ttsModels.length > 0 && (
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
                                [{(model as any).source || 'Gemini SDK'}] {model.displayName}
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
                    ) : vittsOptions?.error ? (
                        <div className="tts-error">⚠️ {vittsOptions.error}</div>
                    ) : (
                        <>
                            {/* Mode Selector */}
                            <div className="tts-row">
                                <label className="tts-label">🎛️ Chế độ:</label>
                                <div className="provider-buttons vitts-mode-buttons">
                                    <button
                                        className={`provider-btn ${vittsMode === 'auto' ? 'active' : ''}`}
                                        onClick={() => handleVittsModeChange('auto')}
                                        disabled={isSaving}
                                        title="Model tự chọn giọng phù hợp"
                                    >
                                        🤖 Auto Voice
                                    </button>
                                    <button
                                        className={`provider-btn ${vittsMode === 'design' ? 'active' : ''}`}
                                        onClick={() => handleVittsModeChange('design')}
                                        disabled={isSaving}
                                        title="Thiết kế giọng theo thuộc tính"
                                    >
                                        🎨 Voice Design
                                    </button>
                                    <button
                                        className={`provider-btn ${vittsMode === 'clone' ? 'active' : ''}`}
                                        onClick={() => handleVittsModeChange('clone')}
                                        disabled={isSaving}
                                        title="Clone giọng từ Voice Library"
                                    >
                                        🎤 Voice Cloning
                                    </button>
                                </div>
                            </div>

                            {/* Mode: Voice Design — attribute dropdowns */}
                            {vittsMode === 'design' && vittsOptions?.design_attributes && (
                                <div className="vitts-design-form">
                                    <div className="tts-row">
                                        <label className="tts-label">👤 Giới tính:</label>
                                        <select className="tts-select" value={designGender}
                                            onChange={(e) => { setDesignGender(e.target.value); }}
                                        >
                                            {vittsOptions.design_attributes.gender.map(g => (
                                                <option key={g} value={g}>{g === 'male' ? '👨 Nam' : '👩 Nữ'}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="tts-row">
                                        <label className="tts-label">🎂 Độ tuổi:</label>
                                        <select className="tts-select" value={designAge}
                                            onChange={(e) => { setDesignAge(e.target.value); }}
                                        >
                                            {vittsOptions.design_attributes.age.map(a => (
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
                                            {vittsOptions.design_attributes.pitch.map(p => (
                                                <option key={p} value={p}>{p}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="tts-row">
                                        <label className="tts-label">💬 Phong cách:</label>
                                        <select className="tts-select" value={designStyle}
                                            onChange={(e) => { setDesignStyle(e.target.value); }}
                                        >
                                            {vittsOptions.design_attributes.style.map(s => (
                                                <option key={s} value={s}>{s === 'whisper' ? '🤫 Thì thầm' : '🗣️ Bình thường'}</option>
                                            ))}
                                        </select>
                                    </div>
                                    {vittsOptions.design_attributes.accent.filter(a => a).length > 0 && (
                                        <div className="tts-row">
                                            <label className="tts-label">🌍 Giọng vùng:</label>
                                            <select className="tts-select" value={designAccent}
                                                onChange={(e) => { setDesignAccent(e.target.value); }}
                                            >
                                                <option value="">Không có</option>
                                                {vittsOptions.design_attributes.accent.filter(a => a).map(a => (
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
                            )}

                            {/* Mode: Voice Cloning — ref selector */}
                            {vittsMode === 'clone' && (
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
