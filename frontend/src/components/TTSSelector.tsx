import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import './ModelSelector.css';

type Provider = 'GEMINI' | 'CLIPROXY' | 'VBEE' | 'VITTS' | string;
type ViTTSEngine = 'vieneu' | 'omnivoice';

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

interface VieNeuPreset {
    id: string;
    name: string;
    region?: string;
    gender?: string;
    style?: string;
    description?: string;
}

interface DesignAttributes {
    gender: string[];
    age: string[];
    pitch: string[];
    style: string[];
    accent: string[];
}

interface ViTTSOptions {
    available_engines?: string[];
    vieneu_presets?: VieNeuPreset[];
    voice_library?: VoiceLibEntry[];
    design_attributes?: DesignAttributes;
    modes?: { id: string; name: string; description: string; params: string[] }[];
    defaults?: { speed: number; num_step: number; normalize: boolean };
    isPersonal?: boolean;
    serverId?: string;
    serverName?: string;
    error?: string;
}

interface ViTTSServerItem {
    id: string;
    name: string;
}

interface TTSSelectorProps {
    onChange?: (config: {
        provider: string;
        model: string;
        voice: string;
        multilingualMode?: string;
        vittsEngine?: string;
        vittsMode?: string;
        vittsDesignInstruct?: string;
        vittsNormalize?: boolean;
    }) => void;
}

const DEFAULT_DESIGN_ATTRIBUTES: DesignAttributes = {
    gender: ['male', 'female'],
    age: ['child', 'young', 'middle-aged', 'elderly'],
    pitch: ['very low', 'low', 'normal', 'high', 'very high'],
    style: ['normal', 'whisper'],
    accent: ['', 'american accent', 'british accent', 'australian accent', 'indian accent'],
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

    const [vittsServers, setVittsServers] = useState<ViTTSServerItem[]>([]);
    const [currentVittsServerId, setCurrentVittsServerId] = useState<string>('');
    const [vittsEngine, setVittsEngine] = useState<ViTTSEngine>('vieneu');
    const [vittsMode, setVittsMode] = useState<string>('preset');
    const [vittsOptions, setVittsOptions] = useState<ViTTSOptions | null>(null);
    const [vittsLoading, setVittsLoading] = useState(false);

    const [designGender, setDesignGender] = useState('female');
    const [designAge, setDesignAge] = useState('young');
    const [designPitch, setDesignPitch] = useState('normal');
    const [designStyle, setDesignStyle] = useState('normal');
    const [designAccent, setDesignAccent] = useState('');
    const [vittsNormalize, setVittsNormalize] = useState(false);

    const parsedServerIdFromVoice = (selectedVoice.startsWith('vitts:') && selectedVoice.split(':').length >= 3)
        ? selectedVoice.split(':')[1]
        : '';
    const activeServerId = currentVittsServerId || parsedServerIdFromVoice || vittsServers[0]?.id || '';

    const buildDesignInstruct = useCallback(() => {
        const parts: string[] = [];
        if (designGender) parts.push(designGender);
        const ageMap: Record<string, string> = { child: 'child', young: 'young adult', 'middle-aged': 'middle-aged', elderly: 'elderly' };
        if (designAge && ageMap[designAge]) parts.push(ageMap[designAge]);
        const pitchMap: Record<string, string> = { 'very low': 'very low pitch', low: 'low pitch', normal: '', high: 'high pitch', 'very high': 'very high pitch' };
        if (designPitch && pitchMap[designPitch]) parts.push(pitchMap[designPitch]);
        if (designStyle && designStyle !== 'normal') parts.push(designStyle);
        if (designAccent) parts.push(designAccent);
        return parts.join(', ');
    }, [designGender, designAge, designPitch, designStyle, designAccent]);

    const fetchViTTSOptions = useCallback(async (serverId?: string): Promise<ViTTSOptions | null> => {
        try {
            setVittsLoading(true);
            const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : '';
            const response = await api.get(`/user/model-config/vitts-options${query}`);
            const data: ViTTSOptions = response.data;
            setVittsOptions(data);
            return data;
        } catch (err) {
            console.error('Error fetching ViTTS options:', err);
            return null;
        } finally {
            setVittsLoading(false);
        }
    }, []);

    const saveConfig = useCallback(async (
        currentProvider: Provider,
        model: string,
        voice: string,
        mode?: string,
        engine?: ViTTSEngine
    ) => {
        try {
            setIsSaving(true);
            setSaveStatus('idle');

            const activeEngine = engine || vittsEngine;
            const activeMode = mode || vittsMode;

            const payload: any = {
                taskType: 'TTS',
                provider: currentProvider,
                modelName: voice || 'vitts:auto',
            };

            if (currentProvider === 'VITTS') {
                if (activeEngine === 'omnivoice' && activeMode === 'design') {
                    payload.voiceDesignInstruct = buildDesignInstruct();
                }
            }

            await api.post('/user/model-config/bulk', {
                configs: [payload]
            });

            setSaveStatus('success');
            setTimeout(() => setSaveStatus('idle'), 2000);

            if (onChange) {
                const voiceId = voice.includes(':') ? voice.split(':').slice(1).join(':') : voice;
                onChange({
                    provider: currentProvider,
                    model,
                    voice: voiceId,
                    vittsEngine: currentProvider === 'VITTS' ? activeEngine : undefined,
                    vittsMode: currentProvider === 'VITTS' ? activeMode : undefined,
                    vittsDesignInstruct: currentProvider === 'VITTS' && activeMode === 'design' ? buildDesignInstruct() : undefined,
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
    }, [onChange, vittsEngine, vittsMode, vittsNormalize, buildDesignInstruct]);

    const fetchModels = async () => {
        try {
            setIsLoading(true);

            const modelsRes = await api.get('/user/model-config/discover');
            const geminiModels = modelsRes.data.models?.GEMINI || [];
            const cliproxyModels = modelsRes.data.models?.CLIPROXY || [];
            const vittsModels = modelsRes.data.models?.VITTS || [];

            const geminiTTS = geminiModels
                .filter((m: AvailableModel) => m.supportedTasks.includes('TTS'))
                .map((m: AvailableModel) => ({ ...m, source: 'Gemini SDK' }));

            const cliproxyTTS = cliproxyModels
                .filter((m: AvailableModel) => m.supportedTasks.includes('TTS'))
                .map((m: AvailableModel) => ({ ...m, source: 'CLIProxy' }));

            const vittsTTS = vittsModels.map((m: AvailableModel) => ({ ...m, source: m.displayName || m.source }));
            const allTTSModels = [...cliproxyTTS, ...geminiTTS, ...vittsTTS];

            Object.keys(modelsRes.data.models || {}).forEach(key => {
                if (['GEMINI', 'CLIPROXY', 'IMAGE_GEN', 'VITTS', 'VBEE'].includes(key)) return;
                const list = modelsRes.data.models[key] || [];
                const customTTS = list
                    .filter((m: AvailableModel) => m.supportedTasks.includes('TTS'))
                    .map((m: AvailableModel) => ({ ...m, source: m.source || key }));
                if (customTTS.length > 0) allTTSModels.push(...customTTS);
            });

            setTtsModels(allTTSModels);

            const allVoices = geminiModels.filter((m: AvailableModel) =>
                m.supportedTasks.includes('TTS_VOICE') ||
                m.name.startsWith('vbee:') ||
                m.name.startsWith('vitts:') ||
                m.name.startsWith('custom_openai:')
            );
            setVoices(allVoices);

            const detectedServers: ViTTSServerItem[] = [];
            vittsModels.forEach((m: AvailableModel) => {
                const sId = m.name.split(':')[1];
                if (sId && !detectedServers.some(s => s.id === sId)) {
                    detectedServers.push({ id: sId, name: m.displayName || m.source || sId });
                }
            });
            setVittsServers(detectedServers);

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
                        const parts = savedVoice.split(':');
                        let sId = parts.length >= 3 ? parts[1] : '';
                        if (!sId && detectedServers.length > 0) sId = detectedServers[0].id;
                        if (sId) {
                            setCurrentVittsServerId(sId);
                            fetchViTTSOptions(sId);
                        }

                        if (savedVoice.includes(':vieneu:')) {
                            setVittsEngine('vieneu');
                            setVittsMode(savedVoice.includes(':vieneu:ref:') ? 'clone' : 'preset');
                        } else {
                            setVittsEngine('omnivoice');
                            if (savedVoice.includes(':ref:')) setVittsMode('clone');
                            else if (savedVoice.endsWith(':auto')) setVittsMode('auto');
                            else setVittsMode('design');
                        }
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
                        const matched = allTTSModels.find(m => m.name === savedVoice);
                        setSelectedModel(matched?.name || allTTSModels[0].name);
                    }

                    if (onChange && (currentProvider === 'VITTS' || savedVoice.startsWith('vitts:'))) {
                        const isVn = savedVoice.includes(':vieneu:');
                        const detectedEngine = isVn ? 'vieneu' : 'omnivoice';
                        const detectedMode = isVn
                            ? (savedVoice.includes(':vieneu:ref:') ? 'clone' : 'preset')
                            : (savedVoice.includes(':ref:') ? 'clone' : savedVoice.endsWith(':auto') ? 'auto' : 'design');

                        onChange({
                            provider: currentProvider || 'VITTS',
                            model: 'vitts',
                            voice: savedVoice,
                            vittsEngine: detectedEngine,
                            vittsMode: detectedMode,
                            vittsDesignInstruct: detectedMode === 'design' ? buildDesignInstruct() : undefined,
                            vittsNormalize,
                        });
                    }
                    return;
                }
            } catch (configErr) {
                console.log('No saved config found, using defaults', configErr);
            }

            if (cliproxyTTS.length > 0) {
                setProvider('CLIPROXY');
                setSelectedModel(cliproxyTTS[0].name);
            } else if (geminiTTS.length > 0) {
                setProvider('GEMINI');
                setSelectedModel(geminiTTS[0].name);
            }
        } catch (err) {
            console.error('Error fetching TTS config:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchModels();
    }, []);

    const handleSelectViTTSServer = async (serverId: string) => {
        setProvider('VITTS');
        setCurrentVittsServerId(serverId);
        const options = await fetchViTTSOptions(serverId);

        const engines = options?.available_engines || ['omnivoice'];
        const hasVieNeu = engines.includes('vieneu');
        const targetEngine: ViTTSEngine = hasVieNeu ? 'vieneu' : 'omnivoice';
        setVittsEngine(targetEngine);

        if (targetEngine === 'vieneu') {
            const presets = options?.vieneu_presets || [];
            if (presets.length > 0) {
                setVittsMode('preset');
                const firstPresetVoice = `vitts:${serverId}:vieneu:${presets[0].id || presets[0].name}`;
                setSelectedVoice(firstPresetVoice);
                setSelectedModel('vitts');
                saveConfig('VITTS', 'vitts', firstPresetVoice, 'preset', 'vieneu');
            } else {
                const refs = options?.voice_library || [];
                const firstRefVoice = refs.length > 0
                    ? `vitts:${serverId}:vieneu:ref:${refs[0].ref_id}`
                    : `vitts:${serverId}:vieneu:Adam`;
                setVittsMode(refs.length > 0 ? 'clone' : 'preset');
                setSelectedVoice(firstRefVoice);
                setSelectedModel('vitts');
                saveConfig('VITTS', 'vitts', firstRefVoice, refs.length > 0 ? 'clone' : 'preset', 'vieneu');
            }
        } else {
            setVittsMode('auto');
            const autoVoice = `vitts:${serverId}:omni:auto`;
            setSelectedVoice(autoVoice);
            setSelectedModel('vitts');
            saveConfig('VITTS', 'vitts', autoVoice, 'auto', 'omnivoice');
        }
    };

    const handleEngineChange = (engine: ViTTSEngine) => {
        setVittsEngine(engine);
        if (engine === 'vieneu') {
            const presets = vittsOptions?.vieneu_presets || [];
            if (presets.length > 0) {
                setVittsMode('preset');
                const voice = `vitts:${activeServerId}:vieneu:${presets[0].id || presets[0].name}`;
                setSelectedVoice(voice);
                saveConfig('VITTS', 'vitts', voice, 'preset', 'vieneu');
            } else {
                const refs = vittsOptions?.voice_library || [];
                const voice = refs.length > 0
                    ? `vitts:${activeServerId}:vieneu:ref:${refs[0].ref_id}`
                    : `vitts:${activeServerId}:vieneu:Adam`;
                setVittsMode(refs.length > 0 ? 'clone' : 'preset');
                setSelectedVoice(voice);
                saveConfig('VITTS', 'vitts', voice, refs.length > 0 ? 'clone' : 'preset', 'vieneu');
            }
        } else {
            setVittsMode('auto');
            const voice = `vitts:${activeServerId}:omni:auto`;
            setSelectedVoice(voice);
            saveConfig('VITTS', 'vitts', voice, 'auto', 'omnivoice');
        }
    };

    const handleProviderChange = (newProvider: Provider) => {
        if (newProvider === 'VITTS') {
            const targetServerId = activeServerId || vittsServers[0]?.id || '';
            handleSelectViTTSServer(targetServerId);
            return;
        }
        setProvider(newProvider);
        let newVoice = '';
        let newModel = selectedModel;
        if (newProvider === 'GEMINI' || newProvider === 'CLIPROXY') {
            const geminiVoices = voices.filter(v => v.name.startsWith('gemini-voice:'));
            newVoice = geminiVoices[0]?.name || '';
            const list = ttsModels.filter(m => newProvider === 'CLIPROXY' ? m.name.startsWith('cliproxy:') : !m.name.startsWith('cliproxy:') && !m.name.startsWith('custom_openai:'));
            newModel = list[0]?.name || selectedModel;
        } else if (newProvider === 'VBEE') {
            const vbeeVoices = voices.filter(v => v.name.startsWith('vbee:'));
            newVoice = vbeeVoices[0]?.name || '';
            newModel = 'vbee-tts';
        } else {
            const customVoices = voices.filter(v => v.name.startsWith(`custom_openai:${newProvider.toLowerCase()}:`));
            const customModels = ttsModels.filter(m => m.name.startsWith(`custom_openai:${newProvider.toLowerCase()}:`));
            newModel = customModels[0]?.name || selectedModel;
            newVoice = customVoices[0]?.name || '';
        }
        setSelectedVoice(newVoice);
        setSelectedModel(newModel);
        saveConfig(newProvider, newModel, newVoice);
    };

    const getFilteredVoices = () => {
        if (provider === 'GEMINI' || provider === 'CLIPROXY') return voices.filter(v => v.name.startsWith('gemini-voice:'));
        if (provider === 'VBEE') return voices.filter(v => v.name.startsWith('vbee:'));
        return voices.filter(v => v.name.startsWith(`custom_openai:${provider.toLowerCase()}:`));
    };

    const filteredVoices = getFilteredVoices();
    const serverRefs = vittsOptions?.voice_library || [];
    const vieneuPresets = vittsOptions?.vieneu_presets || [];
    const availableEngines = vittsOptions?.available_engines || ['omnivoice'];

    if (isLoading) {
        return <div className="tts-selector"><div className="tts-loading">⏳ Đang tải cấu hình TTS...</div></div>;
    }

    return (
        <div className="tts-selector">
            <div className="tts-row">
                <label className="tts-label">🎙️ Nhà cung cấp:</label>
                <div className="provider-buttons">
                    <button className={`provider-btn ${(provider === 'GEMINI' || provider === 'CLIPROXY') ? 'active' : ''}`} onClick={() => handleProviderChange(ttsModels.some(m => m.name.startsWith('cliproxy:')) ? 'CLIPROXY' : 'GEMINI')} disabled={isSaving}>
                        {ttsModels.some(m => m.name.startsWith('cliproxy:')) ? '🌐 Gemini AI' : '🌟 Gemini AI'}
                    </button>
                    <button className={`provider-btn ${provider === 'VBEE' ? 'active' : ''}`} onClick={() => handleProviderChange('VBEE')} disabled={isSaving}>🇻🇳 Vbee TTS</button>
                    <button className={`provider-btn ${provider === 'VITTS' ? 'active' : ''}`} onClick={() => handleProviderChange('VITTS')} disabled={isSaving}>🎙️ ViTTS</button>
                    {Array.from(new Set(ttsModels.filter(m => m.source && !['Gemini SDK', 'CLIProxy', 'VBEE'].includes(m.source) && !vittsServers.some(s => s.name === m.source) && !m.name.startsWith('vitts:')).map(m => m.source as string))).map((cp) => (
                        <button key={cp} className={`provider-btn ${provider === cp ? 'active' : ''}`} onClick={() => handleProviderChange(cp)} disabled={isSaving}>⚡ {cp}</button>
                    ))}
                </div>
                {saveStatus === 'success' && <span className="save-status success">✓ Đã lưu</span>}
                {saveStatus === 'error' && <span className="save-status error">✗ Lỗi lưu</span>}
                {isSaving && <span className="save-status saving">⏳</span>}
            </div>

            {provider !== 'VITTS' && (
                <>
                    {ttsModels.filter(m => m.source === provider || (provider === 'GEMINI' && m.source === 'Gemini SDK') || (provider === 'CLIPROXY' && m.source === 'CLIProxy')).length > 0 && (
                        <div className="tts-row">
                            <label className="tts-label">🔧 Model:</label>
                            <select className="tts-select" value={selectedModel} onChange={(e) => { setSelectedModel(e.target.value); saveConfig(provider, e.target.value, selectedVoice); }} disabled={isSaving}>
                                {ttsModels.filter(model => { if (provider === 'GEMINI') return model.source === 'Gemini SDK'; if (provider === 'CLIPROXY') return model.source === 'CLIProxy'; return model.source === provider; }).map((model) => (
                                    <option key={model.name} value={model.name}>[{model.source}] {model.displayName}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="tts-row">
                        <label className="tts-label">🎤 Giọng đọc:</label>
                        <select className="tts-select voice-select" value={selectedVoice} onChange={(e) => { setSelectedVoice(e.target.value); saveConfig(provider, selectedModel, e.target.value); }} disabled={isSaving}>
                            {filteredVoices.length === 0 ? <option value="">-- Không có giọng đọc --</option> : filteredVoices.map((voice) => <option key={voice.name} value={voice.name}>{voice.displayName}</option>)}
                        </select>
                    </div>
                </>
            )}

            {provider === 'VITTS' && (
                <div className="vitts-omnivoice">
                    {vittsServers.length > 1 && (
                        <div className="tts-row">
                            <label className="tts-label">🖥️ Máy chủ ViTTS:</label>
                            <select
                                className="tts-select"
                                value={activeServerId}
                                onChange={(e) => handleSelectViTTSServer(e.target.value)}
                                disabled={isSaving || vittsLoading}
                            >
                                {vittsServers.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        🖥️ {s.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {vittsServers.length === 1 && (
                        <div className="tts-row">
                            <label className="tts-label">🖥️ Máy chủ ViTTS:</label>
                            <span style={{ padding: '0.35rem 0.75rem', background: 'rgba(255, 255, 255, 0.06)', borderRadius: '6px', fontSize: '0.875rem', color: '#38bdf8', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                🖥️ {vittsServers[0].name}
                            </span>
                        </div>
                    )}

                    {vittsServers.length === 0 && !vittsLoading && (
                        <div className="tts-info">
                            ⚠️ Chưa tìm thấy máy chủ ViTTS khả dụng. Vui lòng cấu hình API Key / Máy chủ ViTTS trong <strong>Cài đặt</strong>.
                        </div>
                    )}

                    {vittsLoading ? (
                        <div className="tts-loading">⏳ Đang tải cấu hình máy chủ ViTTS...</div>
                    ) : (
                        <>
                            {availableEngines.length > 1 && (
                                <div className="tts-row">
                                    <label className="tts-label">🧠 Model TTS:</label>
                                    <div className="provider-buttons vitts-engine-buttons">
                                        <button className={`provider-btn ${vittsEngine === 'vieneu' ? 'active' : ''}`} onClick={() => handleEngineChange('vieneu')} disabled={isSaving}>🇻🇳 VieNeu-TTS (48kHz)</button>
                                        <button className={`provider-btn ${vittsEngine === 'omnivoice' ? 'active' : ''}`} onClick={() => handleEngineChange('omnivoice')} disabled={isSaving}>🌐 OmniVoice (24kHz)</button>
                                    </div>
                                </div>
                            )}

                            {vittsEngine === 'vieneu' && (
                                <>
                                    <div className="tts-row">
                                        <label className="tts-label">🎛️ Chế độ:</label>
                                        <div className="provider-buttons vitts-mode-buttons">
                                            <button className={`provider-btn ${vittsMode === 'preset' ? 'active' : ''}`} onClick={() => { setVittsMode('preset'); const first = vieneuPresets[0]?.id || 'Adam'; const v = `vitts:${activeServerId}:vieneu:${first}`; setSelectedVoice(v); saveConfig('VITTS', 'vitts', v, 'preset', 'vieneu'); }} disabled={isSaving}>🗣️ Giọng có sẵn ({vieneuPresets.length})</button>
                                            <button className={`provider-btn ${vittsMode === 'clone' ? 'active' : ''}`} onClick={() => { setVittsMode('clone'); const firstRef = serverRefs[0]?.ref_id || ''; const v = firstRef ? `vitts:${activeServerId}:vieneu:ref:${firstRef}` : `vitts:${activeServerId}:vieneu:Adam`; setSelectedVoice(v); saveConfig('VITTS', 'vitts', v, 'clone', 'vieneu'); }} disabled={isSaving}>🎤 Giọng clone ({serverRefs.length})</button>
                                        </div>
                                    </div>
                                    {vittsMode === 'preset' && (
                                        <div className="tts-row">
                                            <label className="tts-label">🗣️ Chọn giọng đọc:</label>
                                            <select
                                                className="tts-select voice-select"
                                                value={selectedVoice}
                                                onChange={(e) => {
                                                    setSelectedVoice(e.target.value);
                                                    saveConfig('VITTS', 'vitts', e.target.value, 'preset', 'vieneu');
                                                }}
                                                disabled={isSaving}
                                            >
                                                {vieneuPresets.length === 0 ? (
                                                    <option value={`vitts:${activeServerId}:vieneu:Adam`}>[Miền Nam] Nam - Adam (Tự nhiên, truyền cảm)</option>
                                                ) : (
                                                    (() => {
                                                        const regionOrder: Record<string, number> = { 'Bắc': 1, 'bac': 1, 'Trung': 2, 'trung': 2, 'Nam': 3, 'nam': 3 };
                                                        const genderOrder: Record<string, number> = { 'Nam': 1, 'nam': 1, 'male': 1, 'Nữ': 2, 'nu': 2, 'female': 2 };
                                                        const sorted = [...vieneuPresets].sort((a, b) => {
                                                            const rA = regionOrder[a.region || ''] || 99;
                                                            const rB = regionOrder[b.region || ''] || 99;
                                                            if (rA !== rB) return rA - rB;
                                                            const gA = genderOrder[a.gender || ''] || 99;
                                                            const gB = genderOrder[b.gender || ''] || 99;
                                                            if (gA !== gB) return gA - gB;
                                                            return (a.name || '').localeCompare(b.name || '', 'vi');
                                                        });

                                                        const north = sorted.filter(p => (p.region || '').toLowerCase().includes('bắc'));
                                                        const central = sorted.filter(p => (p.region || '').toLowerCase().includes('trung'));
                                                        const south = sorted.filter(p => (p.region || '').toLowerCase().includes('nam'));
                                                        const others = sorted.filter(p => !north.includes(p) && !central.includes(p) && !south.includes(p));

                                                        const renderPresetOption = (p: VieNeuPreset) => {
                                                            const voiceKey = `vitts:${activeServerId}:vieneu:${p.id || p.name}`;
                                                            const label = `[Miền ${p.region || 'Bắc'}] ${p.gender || 'Nam'} - ${p.name} (${p.description || p.style || 'Tự nhiên'})`;
                                                            return (
                                                                <option key={voiceKey} value={voiceKey}>
                                                                    {label}
                                                                </option>
                                                            );
                                                        };

                                                        return (
                                                            <>
                                                                {north.length > 0 && (
                                                                    <optgroup label="────── 🇻🇳 Miền Bắc (Nam trước, Nữ sau) ──────">
                                                                        {north.map(renderPresetOption)}
                                                                    </optgroup>
                                                                )}
                                                                {central.length > 0 && (
                                                                    <optgroup label="────── 🇻🇳 Miền Trung (Nam trước, Nữ sau) ──────">
                                                                        {central.map(renderPresetOption)}
                                                                    </optgroup>
                                                                )}
                                                                {south.length > 0 && (
                                                                    <optgroup label="────── 🇻🇳 Miền Nam (Nam trước, Nữ sau) ──────">
                                                                        {south.map(renderPresetOption)}
                                                                    </optgroup>
                                                                )}
                                                                {others.length > 0 && (
                                                                    <optgroup label="────── 🇻🇳 Giọng khác ──────">
                                                                        {others.map(renderPresetOption)}
                                                                    </optgroup>
                                                                )}
                                                            </>
                                                        );
                                                    })()
                                                )}
                                            </select>
                                        </div>
                                    )}
                                    {vittsMode === 'clone' && (
                                        <div className="tts-row">
                                            <label className="tts-label">🎤 Chọn giọng clone:</label>
                                            <select className="tts-select voice-select" value={selectedVoice} onChange={(e) => { setSelectedVoice(e.target.value); saveConfig('VITTS', 'vitts', e.target.value, 'clone', 'vieneu'); }} disabled={isSaving}>
                                                {serverRefs.length === 0 ? <option value="">-- Máy chủ này chưa có giọng mẫu ref --</option> : serverRefs.map((ref) => <option key={`vitts:${activeServerId}:vieneu:ref:${ref.ref_id}`} value={`vitts:${activeServerId}:vieneu:ref:${ref.ref_id}`}>🎤 {ref.name} {ref.duration_sec ? `(${ref.duration_sec.toFixed(1)}s)` : ''}</option>)}
                                            </select>
                                        </div>
                                    )}
                                </>
                            )}

                            {vittsEngine === 'omnivoice' && (
                                <>
                                    <div className="tts-row">
                                        <label className="tts-label">🎛️ Chế độ:</label>
                                        <div className="provider-buttons vitts-mode-buttons">
                                            <button className={`provider-btn ${vittsMode === 'auto' ? 'active' : ''}`} onClick={() => { setVittsMode('auto'); const v = `vitts:${activeServerId}:omni:auto`; setSelectedVoice(v); saveConfig('VITTS', 'vitts', v, 'auto', 'omnivoice'); }} disabled={isSaving}>🤖 Tự động</button>
                                            <button className={`provider-btn ${vittsMode === 'clone' ? 'active' : ''}`} onClick={() => { setVittsMode('clone'); const firstRef = serverRefs[0]?.ref_id || ''; const v = firstRef ? `vitts:${activeServerId}:omni:ref:${firstRef}` : `vitts:${activeServerId}:omni:auto`; setSelectedVoice(v); saveConfig('VITTS', 'vitts', v, 'clone', 'omnivoice'); }} disabled={isSaving}>🎤 Giọng clone ({serverRefs.length})</button>
                                            <button className={`provider-btn ${vittsMode === 'design' ? 'active' : ''}`} onClick={() => { setVittsMode('design'); const v = `vitts:${activeServerId}:omni:design`; setSelectedVoice(v); saveConfig('VITTS', 'vitts', v, 'design', 'omnivoice'); }} disabled={isSaving}>🎭 Voice Design</button>
                                        </div>
                                    </div>
                                    {vittsMode === 'auto' && <div className="tts-info">🤖 Model OmniVoice tự động chọn giọng phù hợp nhất</div>}
                                    {vittsMode === 'clone' && (
                                        <div className="tts-row">
                                            <label className="tts-label">🎤 Chọn giọng clone:</label>
                                            <select className="tts-select voice-select" value={selectedVoice} onChange={(e) => { setSelectedVoice(e.target.value); saveConfig('VITTS', 'vitts', e.target.value, 'clone', 'omnivoice'); }} disabled={isSaving}>
                                                {serverRefs.length === 0 ? <option value="">-- Chưa có giọng mẫu ref --</option> : serverRefs.map((ref) => <option key={`vitts:${activeServerId}:omni:ref:${ref.ref_id}`} value={`vitts:${activeServerId}:omni:ref:${ref.ref_id}`}>🎤 {ref.name} {ref.duration_sec ? `(${ref.duration_sec.toFixed(1)}s)` : ''}</option>)}
                                            </select>
                                        </div>
                                    )}
                                    {vittsMode === 'design' && (
                                        (() => {
                                            const attrs = vittsOptions?.design_attributes || DEFAULT_DESIGN_ATTRIBUTES;
                                            return (
                                                <div className="vitts-design-form">
                                                    <div className="tts-row"><label className="tts-label">👤 Giới tính:</label><select className="tts-select" value={designGender} onChange={(e) => setDesignGender(e.target.value)}>{attrs.gender.map(g => <option key={g} value={g}>{g === 'male' ? '👨 Nam' : '👩 Nữ'}</option>)}</select></div>
                                                    <div className="tts-row"><label className="tts-label">🎂 Độ tuổi:</label><select className="tts-select" value={designAge} onChange={(e) => setDesignAge(e.target.value)}>{attrs.age.map(a => <option key={a} value={a}>{a === 'child' ? '👶 Trẻ em' : a === 'young' ? '🧑 Trẻ' : a === 'middle-aged' ? '🧔 Trung niên' : '👴 Lớn tuổi'}</option>)}</select></div>
                                                    <div className="tts-row"><label className="tts-label">🎵 Cao độ:</label><select className="tts-select" value={designPitch} onChange={(e) => setDesignPitch(e.target.value)}>{attrs.pitch.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                                                    <div className="tts-row"><label className="tts-label">💬 Phong cách:</label><select className="tts-select" value={designStyle} onChange={(e) => setDesignStyle(e.target.value)}>{attrs.style.map(s => <option key={s} value={s}>{s === 'whisper' ? '🤫 Thì thầm' : '🗣️ Bình thường'}</option>)}</select></div>
                                                    {attrs.accent.filter(a => a).length > 0 && (
                                                        <div className="tts-row"><label className="tts-label">🌍 Giọng vùng:</label><select className="tts-select" value={designAccent} onChange={(e) => setDesignAccent(e.target.value)}><option value="">Không có</option>{attrs.accent.filter(a => a).map(a => <option key={a} value={a}>{a}</option>)}</select></div>
                                                    )}
                                                    <div className="vitts-design-preview">💡 Instruct: <em>{buildDesignInstruct()}</em></div>
                                                    <button className="btn-apply-design" onClick={() => saveConfig('VITTS', 'vitts', `vitts:${activeServerId}:omni:design`, 'design', 'omnivoice')} disabled={isSaving}>✅ Áp dụng</button>
                                                </div>
                                            );
                                        })()
                                    )}
                                </>
                            )}
                            <div className="tts-row vitts-normalize-row">
                                <label className="vitts-normalize-label">
                                    <input type="checkbox" checked={vittsNormalize} onChange={(e) => { setVittsNormalize(e.target.checked); saveConfig('VITTS', 'vitts', selectedVoice, vittsMode, vittsEngine); }} disabled={isSaving} />
                                    <span className="normalize-checkbox-icon">{vittsNormalize ? '☑️' : '☐'}</span> SEA-G2P Normalize
                                </label>
                                <span className="normalize-hint">Chuẩn hóa phát âm tiếng Việt (khuyến nghị bật)</span>
                            </div>
                        </>
                    )}
                </div>
            )}
            <div className="tts-info">💡 Chọn nhà cung cấp và giọng đọc, sau đó nhấn "Tạo Audio" cho từng slide</div>
        </div>
    );
}
