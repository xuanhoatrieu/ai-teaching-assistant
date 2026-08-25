import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { UsefulLinksAdmin } from '../../components/admin/UsefulLinksAdmin';
import './AdminPage.css';

interface SettingsData {
    geminiApiKey: string;
    encryptionKey: string;
    hasGeminiKey: boolean;
    hasEncryptionKey: boolean;
}

interface CLIProxyConfig {
    enabled: boolean;
    url: string;
    apiKey: string;
    defaultTextModel: string;
    defaultImageModel: string;
    defaultTTSModel: string;
}

interface ImageGenConfig {
    enabled: boolean;
    url: string;
    apiKey: string;
    defaultModel: string;
    steps: number;
}

export function SettingsPage() {
    const [geminiKey, setGeminiKey] = useState('');
    const [encryptionKey, setEncryptionKey] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [settings, setSettings] = useState<SettingsData | null>(null);

    // CLIProxy state
    const [cliproxyConfig, setCliproxyConfig] = useState<CLIProxyConfig | null>(null);
    const [cliproxyEnabled, setCliproxyEnabled] = useState(false);
    const [cliproxyUrl, setCliproxyUrl] = useState('');
    const [cliproxyApiKey, setCliproxyApiKey] = useState('');
    const [cliproxyTestResult, setCliproxyTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTestingCliproxy, setIsTestingCliproxy] = useState(false);
    const [isSavingCliproxy, setIsSavingCliproxy] = useState(false);
    const [defaultTextModel, setDefaultTextModel] = useState('');
    const [defaultImageModel, setDefaultImageModel] = useState('');
    const [defaultTTSModel, setDefaultTTSModel] = useState('');
    const [defaultEmbeddingModel, setDefaultEmbeddingModel] = useState('');
    const [categorizedModels, setCategorizedModels] = useState<{
        text: { id: string; source: string }[];
        image: { id: string; source: string }[];
        tts: { id: string; source: string }[];
        embedding: { id: string; source: string }[];
    }>({ text: [], image: [], tts: [], embedding: [] });

    // ImageGen state
    const [imageGenConfig, setImageGenConfig] = useState<ImageGenConfig | null>(null);
    const [imageGenEnabled, setImageGenEnabled] = useState(false);
    const [imageGenUrl, setImageGenUrl] = useState('');
    const [imageGenApiKey, setImageGenApiKey] = useState('');
    const [imageGenModel, setImageGenModel] = useState('flux-image');
    const [imageGenSteps, setImageGenSteps] = useState(20);
    const [imageGenTestResult, setImageGenTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTestingImageGen, setIsTestingImageGen] = useState(false);
    const [isSavingImageGen, setIsSavingImageGen] = useState(false);



    // ViTTS Multi-Server state
    const [vittsServers, setVittsServers] = useState<any[]>([]);
    const [isLoadingVittsServers, setIsLoadingVittsServers] = useState(false);
    const [isVittsModalOpen, setIsVittsModalOpen] = useState(false);
    const [editingVittsServerId, setEditingVittsServerId] = useState<string | null>(null);
    const [vittsFormName, setVittsFormName] = useState('');
    const [vittsFormBaseUrl, setVittsFormBaseUrl] = useState('');
    const [vittsFormApiKey, setVittsFormApiKey] = useState('');
    const [vittsFormEnabled, setVittsFormEnabled] = useState(true);
    const [vittsFormDefaultVoice, setVittsFormDefaultVoice] = useState('vitts:design');
    const [vittsFormDesignInstruct, setVittsFormDesignInstruct] = useState('male, middle-aged');
    const [vittsServerTestResults, setVittsServerTestResults] = useState<Record<string, { success: boolean; message: string; voices?: any[]; refs?: any[]; loading?: boolean }>>({});

    const fetchViTTSServers = async () => {
        setIsLoadingVittsServers(true);
        try {
            const response = await api.get('/admin/config/vitts/servers');
            setVittsServers(response.data || []);
        } catch (err) {
            console.error('Failed to fetch ViTTS servers:', err);
        } finally {
            setIsLoadingVittsServers(false);
        }
    };

    const handleOpenVittsModal = (server?: any) => {
        if (server) {
            setEditingVittsServerId(server.id);
            setVittsFormName(server.name);
            setVittsFormBaseUrl(server.baseUrl);
            setVittsFormApiKey('');
            setVittsFormEnabled(server.enabled);
            setVittsFormDefaultVoice(server.defaultVoice || 'vitts:design');
            setVittsFormDesignInstruct(server.designInstruct || 'male, middle-aged');
        } else {
            setEditingVittsServerId(null);
            setVittsFormName('');
            setVittsFormBaseUrl('http://10.64.11.16:8888');
            setVittsFormApiKey('');
            setVittsFormEnabled(true);
            setVittsFormDefaultVoice('vitts:design');
            setVittsFormDesignInstruct('male, middle-aged');
        }
        setIsVittsModalOpen(true);
    };

    const handleSaveViTTSServer = async () => {
        if (!vittsFormName || !vittsFormBaseUrl) {
            alert('Vui lòng nhập đầy đủ Tên máy chủ và Base URL');
            return;
        }

        try {
            const payload: any = {
                name: vittsFormName,
                baseUrl: vittsFormBaseUrl,
                enabled: vittsFormEnabled,
                defaultVoice: vittsFormDefaultVoice,
                designInstruct: vittsFormDesignInstruct,
            };
            if (vittsFormApiKey) {
                payload.apiKey = vittsFormApiKey;
            }

            if (editingVittsServerId) {
                await api.put(`/admin/config/vitts/servers/${editingVittsServerId}`, payload);
            } else {
                await api.post('/admin/config/vitts/servers', payload);
            }

            setIsVittsModalOpen(false);
            fetchViTTSServers();
        } catch (err: any) {
            alert(`Lỗi lưu máy chủ: ${err.response?.data?.message || err.message}`);
        }
    };

    const handleDeleteViTTSServer = async (id: string, name: string) => {
        if (!window.confirm(`Bạn có chắc muốn xóa máy chủ ViTTS "${name}"?`)) return;
        try {
            await api.delete(`/admin/config/vitts/servers/${id}`);
            fetchViTTSServers();
        } catch (err: any) {
            alert(`Lỗi khi xóa: ${err.response?.data?.message || err.message}`);
        }
    };

    const handleToggleViTTSServer = async (server: any) => {
        try {
            await api.put(`/admin/config/vitts/servers/${server.id}`, {
                enabled: !server.enabled,
                apiKey: '***',
            });
            fetchViTTSServers();
        } catch (err: any) {
            alert(`Lỗi: ${err.response?.data?.message || err.message}`);
        }
    };

    const handleTestViTTSServer = async (id: string) => {
        setVittsServerTestResults(prev => ({ ...prev, [id]: { loading: true, success: false, message: 'Đang kiểm tra kết nối...' } }));
        try {
            const response = await api.get(`/admin/config/vitts/servers/${id}/test`);
            setVittsServerTestResults(prev => ({
                ...prev,
                [id]: {
                    loading: false,
                    success: response.data.success,
                    message: response.data.message,
                    voices: response.data.voices,
                    refs: response.data.refs,
                },
            }));
        } catch (err: any) {
            setVittsServerTestResults(prev => ({
                ...prev,
                [id]: {
                    loading: false,
                    success: false,
                    message: err.response?.data?.message || err.message,
                },
            }));
        }
    };

    // SMTP state
    const [smtpEnabled, setSmtpEnabled] = useState(false);
    const [smtpHost, setSmtpHost] = useState('');
    const [smtpPort, setSmtpPort] = useState('587');
    const [smtpUser, setSmtpUser] = useState('');
    const [smtpPass, setSmtpPass] = useState('');
    const [smtpFrom, setSmtpFrom] = useState('');
    const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTestingSmtp, setIsTestingSmtp] = useState(false);
    const [isSavingSmtp, setIsSavingSmtp] = useState(false);

    // Custom OpenAI Providers state
    const [customProviders, setCustomProviders] = useState<any[]>([]);
    const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
    const [customName, setCustomName] = useState('');
    const [customUrl, setCustomUrl] = useState('');
    const [customApiKey, setCustomApiKey] = useState('');
    const [customEnabled, setCustomEnabled] = useState(true);
    const [customTtsType, setCustomTtsType] = useState<'none' | 'openai' | 'shopaikey'>('none');
    const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
    const [customTestResults, setCustomTestResults] = useState<Record<string, { success: boolean; message: string; loading?: boolean }>>({});

    const fetchCustomProviders = async () => {
        try {
            const response = await api.get('/admin/config/custom-openai');
            setCustomProviders(response.data);
        } catch (err) {
            console.error('Failed to fetch custom providers:', err);
        }
    };

    const handleOpenCustomModal = (provider?: any) => {
        if (provider) {
            setEditingCustomId(provider.id);
            setCustomName(provider.name);
            setCustomUrl(provider.url);
            setCustomApiKey('***');
            setCustomEnabled(provider.enabled);
            setCustomTtsType(provider.ttsType);
        } else {
            setEditingCustomId(null);
            setCustomName('');
            setCustomUrl('');
            setCustomApiKey('');
            setCustomEnabled(true);
            setCustomTtsType('none');
        }
        setIsCustomModalOpen(true);
    };

    const handleSaveCustomProvider = async () => {
        if (!customName || !customUrl) {
            alert('Vui lòng nhập đầy đủ Tên và URL.');
            return;
        }

        try {
            const payload = {
                name: customName,
                url: customUrl,
                apiKey: customApiKey || undefined,
                enabled: customEnabled,
                ttsType: customTtsType,
            };

            if (editingCustomId) {
                await api.put(`/admin/config/custom-openai/${editingCustomId}`, payload);
            } else {
                await api.post('/admin/config/custom-openai', payload);
            }

            setIsCustomModalOpen(false);
            setMessage(editingCustomId ? 'Đã cập nhật cấu hình thành công' : 'Đã thêm nhà cung cấp mới thành công');
            fetchCustomProviders();
        } catch (err: any) {
            alert(err.response?.data?.message || 'Có lỗi xảy ra khi lưu cấu hình.');
        }
    };

    const handleDeleteCustomProvider = async (id: string) => {
        if (!window.confirm('Bạn có chắc chắn muốn xóa nhà cung cấp này không?')) return;
        try {
            await api.delete(`/admin/config/custom-openai/${id}`);
            setMessage('Đã xóa nhà cung cấp thành công');
            fetchCustomProviders();
        } catch (err: any) {
            alert(err.response?.data?.message || 'Xóa nhà cung cấp thất bại.');
        }
    };

    const handleTestCustomProvider = async (id: string) => {
        setCustomTestResults(prev => ({ ...prev, [id]: { success: false, message: 'Đang thử...', loading: true } }));
        try {
            const response = await api.get(`/admin/config/custom-openai/${id}/test`);
            setCustomTestResults(prev => ({
                ...prev,
                [id]: {
                    success: response.data.success,
                    message: response.data.message,
                    loading: false
                }
            }));
            fetchCustomProviders();
        } catch (err: any) {
            setCustomTestResults(prev => ({
                ...prev,
                [id]: {
                    success: false,
                    message: err.response?.data?.message || 'Kết nối thất bại.',
                    loading: false
                }
            }));
        }
    };

    const handleToggleCustomProvider = async (provider: any) => {
        try {
            await api.put(`/admin/config/custom-openai/${provider.id}`, {
                ...provider,
                enabled: !provider.enabled,
                apiKey: '***'
            });
            fetchCustomProviders();
        } catch (err: any) {
            alert(err.response?.data?.message || 'Không thể thay đổi trạng thái.');
        }
    };

    useEffect(() => {
        fetchSettings();
        fetchCLIProxyConfig();
        fetchImageGenConfig();
        fetchViTTSServers();
        fetchSMTPConfig();
        fetchCustomProviders();
    }, []);

    const fetchSMTPConfig = async () => {
        try {
            const response = await api.get('/admin/config/smtp');
            const config = response.data;
            setSmtpEnabled(config.enabled);
            setSmtpHost(config.host || '');
            setSmtpPort(config.port || '587');
            setSmtpUser(config.user || '');
            setSmtpFrom(config.from || '');
        } catch (err) {
            console.error('Failed to fetch SMTP config:', err);
        }
    };

    const fetchSettings = async () => {
        try {
            const response = await api.get('/admin/settings');
            setSettings(response.data);
        } catch (err) {
            console.error('Failed to fetch settings:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchCLIProxyConfig = async () => {
        try {
            const response = await api.get('/admin/config/cliproxy');
            const config = response.data;
            setCliproxyConfig(config);
            setCliproxyEnabled(config.enabled);
            setCliproxyUrl(config.url || '');
            setDefaultTextModel(config.defaultTextModel || '');
            setDefaultImageModel(config.defaultImageModel || '');
            setDefaultTTSModel(config.defaultTTSModel || '');
            setDefaultEmbeddingModel(config.defaultEmbeddingModel || '');

            // Fetch available models if enabled
            if (config.enabled) {
                try {
                    const testRes = await api.get('/admin/config/cliproxy/test');
                    if (testRes.data.categorized) {
                        setCategorizedModels(testRes.data.categorized);
                    }
                } catch (e) {
                    console.log('Could not fetch models');
                }
            }
        } catch (err) {
            console.error('Failed to fetch CLIProxy config:', err);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        setMessage('');

        try {
            const response = await api.put('/admin/settings', {
                geminiApiKey: geminiKey || undefined,
                encryptionKey: encryptionKey || undefined,
            });
            setMessage(response.data.message);
            setGeminiKey('');
            setEncryptionKey('');
            await fetchSettings();
        } catch (err: any) {
            setMessage(err.response?.data?.message || 'Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveCliproxy = async () => {
        setIsSavingCliproxy(true);
        try {
            const payload = {
                enabled: cliproxyEnabled,
                url: cliproxyUrl || undefined,
                apiKey: cliproxyApiKey || undefined,
                defaultTextModel: defaultTextModel || undefined,
                defaultImageModel: defaultImageModel || undefined,
                defaultTTSModel: defaultTTSModel || undefined,
            };
            console.log('[Settings] Saving CLIProxy config:', payload);
            await api.put('/admin/config/cliproxy', payload);
            setMessage('CLIProxy configuration saved');
            setCliproxyApiKey('');
            await fetchCLIProxyConfig();
        } catch (err: any) {
            console.error('[Settings] Save error:', err.response?.data);
            setMessage(err.response?.data?.message || 'Failed to save CLIProxy config');
        } finally {
            setIsSavingCliproxy(false);
        }
    };

    const handleTestCliproxy = async () => {
        setIsTestingCliproxy(true);
        setCliproxyTestResult(null);
        try {
            // Auto-save config first so the test uses the latest input values
            const payload = {
                enabled: cliproxyEnabled,
                url: cliproxyUrl || undefined,
                apiKey: cliproxyApiKey || undefined,
                defaultTextModel: defaultTextModel || undefined,
                defaultImageModel: defaultImageModel || undefined,
                defaultTTSModel: defaultTTSModel || undefined,
                defaultEmbeddingModel: defaultEmbeddingModel || undefined,
            };
            await api.put('/admin/config/cliproxy', payload);
            setCliproxyApiKey(''); // clear API key after saving

            // Now test with the saved config
            const response = await api.get('/admin/config/cliproxy/test');
            setCliproxyTestResult(response.data);

            if (response.data.categorized) {
                setCategorizedModels(response.data.categorized);
            }

            // Refresh config display
            await fetchCLIProxyConfig();
        } catch (err: any) {
            setCliproxyTestResult({
                success: false,
                message: err.response?.data?.message || 'Connection test failed',
            });
        } finally {
            setIsTestingCliproxy(false);
        }
    };

    // ========================
    // ImageGen handlers
    // ========================

    const fetchImageGenConfig = async () => {
        try {
            const response = await api.get('/admin/config/image-gen');
            const config = response.data;
            setImageGenConfig(config);
            setImageGenEnabled(config.enabled);
            setImageGenUrl(config.url || '');
            setImageGenModel(config.defaultModel || 'flux-image');
            setImageGenSteps(config.steps || 20);
        } catch (err) {
            console.error('Failed to fetch ImageGen config:', err);
        }
    };

    const handleSaveImageGen = async () => {
        setIsSavingImageGen(true);
        try {
            await api.put('/admin/config/image-gen', {
                enabled: imageGenEnabled,
                url: imageGenUrl || undefined,
                apiKey: imageGenApiKey || undefined,
                defaultModel: imageGenModel || undefined,
                steps: imageGenSteps,
            });
            setMessage('Image Gen configuration saved');
            setImageGenApiKey('');
            await fetchImageGenConfig();
        } catch (err: any) {
            setMessage(err.response?.data?.message || 'Failed to save Image Gen config');
        } finally {
            setIsSavingImageGen(false);
        }
    };

    const handleTestImageGen = async () => {
        setIsTestingImageGen(true);
        setImageGenTestResult(null);
        try {
            // Auto-save first
            await api.put('/admin/config/image-gen', {
                enabled: imageGenEnabled,
                url: imageGenUrl || undefined,
                apiKey: imageGenApiKey || undefined,
                defaultModel: imageGenModel || undefined,
                steps: imageGenSteps,
            });
            setImageGenApiKey('');

            const response = await api.get('/admin/config/image-gen/test');
            setImageGenTestResult(response.data);
            await fetchImageGenConfig();
        } catch (err: any) {
            setImageGenTestResult({
                success: false,
                message: err.response?.data?.message || 'Connection test failed',
            });
        } finally {
            setIsTestingImageGen(false);
        }
    };

    // ========================
    // ViTTS handlers
    // ========================



    const handleSaveSMTP = async () => {
        setIsSavingSmtp(true);
        setMessage('');
        try {
            await api.put('/admin/config/smtp', {
                enabled: smtpEnabled,
                host: smtpHost || undefined,
                port: smtpPort || undefined,
                user: smtpUser || undefined,
                pass: smtpPass || undefined,
                from: smtpFrom || undefined,
            });
            setMessage('Đã lưu cấu hình SMTP thành công!');
            setSmtpPass('');
            await fetchSMTPConfig();
        } catch (err: any) {
            setMessage(err.response?.data?.message || 'Không thể lưu cấu hình SMTP');
        } finally {
            setIsSavingSmtp(false);
        }
    };

    const handleTestSMTP = async () => {
        setIsTestingSmtp(true);
        setSmtpTestResult(null);
        try {
            await api.put('/admin/config/smtp', {
                enabled: smtpEnabled,
                host: smtpHost || undefined,
                port: smtpPort || undefined,
                user: smtpUser || undefined,
                pass: smtpPass || undefined,
                from: smtpFrom || undefined,
            });
            setSmtpPass('');

            const response = await api.get('/admin/config/smtp/test');
            setSmtpTestResult(response.data);
            await fetchSMTPConfig();
        } catch (err: any) {
            setSmtpTestResult({
                success: false,
                message: err.response?.data?.message || 'Test kết nối SMTP thất bại',
            });
        } finally {
            setIsTestingSmtp(false);
        }
    };

    if (isLoading) {
        return <div className="admin-page loading">Loading...</div>;
    }

    return (
        <div className="admin-page">
            <div className="page-header">
                <div>
                    <h1>Settings</h1>
                    <p>Configure API keys and system settings</p>
                </div>
            </div>

            {/* CLIProxy Section */}
            <div className="settings-section cliproxy-section">
                <h2>🌐 CLIProxy AI Provider</h2>
                <p className="section-desc">
                    CLIProxy allows using shared AI resources without individual API keys.
                </p>

                <div className="setting-group">
                    <label className="toggle-label">
                        <input
                            type="checkbox"
                            checked={cliproxyEnabled}
                            onChange={(e) => setCliproxyEnabled(e.target.checked)}
                        />
                        <span>Enable CLIProxy</span>
                        {cliproxyEnabled && <span className="status-badge enabled">Active</span>}
                        {!cliproxyEnabled && <span className="status-badge disabled">Disabled</span>}
                    </label>
                    <p className="help-text">
                        When enabled, AI requests will be routed through CLIProxy server
                    </p>
                </div>

                {cliproxyEnabled && (
                    <>
                        <div className="setting-group">
                            <label htmlFor="cliproxy-url">CLIProxy URL</label>
                            <input
                                id="cliproxy-url"
                                type="text"
                                value={cliproxyUrl}
                                onChange={(e) => setCliproxyUrl(e.target.value)}
                                placeholder="http://152.67.112.145:8317"
                            />
                            <p className="help-text">Current: {cliproxyConfig?.url || 'Not set'}</p>
                        </div>

                        <div className="setting-group">
                            <label htmlFor="cliproxy-apikey">API Key</label>
                            <input
                                id="cliproxy-apikey"
                                type="password"
                                value={cliproxyApiKey}
                                onChange={(e) => setCliproxyApiKey(e.target.value)}
                                placeholder="Enter new API key to update"
                            />
                            <p className="help-text">
                                Current: {cliproxyConfig?.apiKey || 'Not set'}
                            </p>
                        </div>

                        <div className="setting-group">
                            <label htmlFor="default-text-model">📝 Default Text Model</label>
                            <select
                                id="default-text-model"
                                value={defaultTextModel}
                                onChange={(e) => setDefaultTextModel(e.target.value)}
                            >
                                {categorizedModels.text.length === 0 ? (
                                    <option value={defaultTextModel}>{defaultTextModel || '-- Test Connection để load models --'}</option>
                                ) : (
                                    categorizedModels.text.map(m => (
                                        <option key={`${m.source}:${m.id}`} value={m.id}>[{m.source}] {m.id}</option>
                                    ))
                                )}
                            </select>
                            <p className="help-text">Model cho Outline, Slides, Questions</p>
                        </div>

                        <div className="setting-group">
                            <label htmlFor="default-image-model">🖼️ Default Image Model</label>
                            <select
                                id="default-image-model"
                                value={defaultImageModel}
                                onChange={(e) => setDefaultImageModel(e.target.value)}
                            >
                                {categorizedModels.image.length === 0 ? (
                                    <option value={defaultImageModel}>{defaultImageModel || '-- Test Connection để load models --'}</option>
                                ) : (
                                    categorizedModels.image.map(m => (
                                        <option key={`${m.source}:${m.id}`} value={m.id}>[{m.source}] {m.id}</option>
                                    ))
                                )}
                            </select>
                            <p className="help-text">Model cho tạo ảnh minh hoạ</p>
                        </div>

                        <div className="setting-group">
                            <label htmlFor="default-tts-model">🔊 Default TTS Model</label>
                            <select
                                id="default-tts-model"
                                value={defaultTTSModel}
                                onChange={(e) => setDefaultTTSModel(e.target.value)}
                            >
                                {categorizedModels.tts.length === 0 ? (
                                    <option value={defaultTTSModel}>{defaultTTSModel || '-- Test Connection để load models --'}</option>
                                ) : (
                                    categorizedModels.tts.map(m => (
                                        <option key={`${m.source}:${m.id}`} value={m.id}>[{m.source}] {m.id}</option>
                                    ))
                                )}
                            </select>
                            <p className="help-text">Model cho tạo giọng đọc TTS</p>
                        </div>

                        <div className="setting-group">
                            <label htmlFor="default-embedding-model">🔎 Default Embedding Model</label>
                            <select
                                id="default-embedding-model"
                                value={defaultEmbeddingModel}
                                onChange={(e) => setDefaultEmbeddingModel(e.target.value)}
                            >
                                {categorizedModels.embedding.length === 0 ? (
                                    <option value={defaultEmbeddingModel}>{defaultEmbeddingModel || '-- Test Connection để load models --'}</option>
                                ) : (
                                    categorizedModels.embedding.map(m => (
                                        <option key={`${m.source}:${m.id}`} value={m.id}>[{m.source}] {m.id}</option>
                                    ))
                                )}
                            </select>
                            <p className="help-text">Model embedding cho RAG tài liệu (tạo Textbook Pro)</p>
                        </div>

                        <div className="button-group">
                            <button
                                className="secondary-btn"
                                onClick={handleTestCliproxy}
                                disabled={isTestingCliproxy}
                            >
                                {isTestingCliproxy ? '⏳ Testing...' : '🔍 Test Connection'}
                            </button>
                            <button
                                className="primary-btn"
                                onClick={handleSaveCliproxy}
                                disabled={isSavingCliproxy}
                            >
                                {isSavingCliproxy ? 'Saving...' : 'Save CLIProxy Settings'}
                            </button>
                        </div>

                        {cliproxyTestResult && (
                            <div className={`test-result ${cliproxyTestResult.success ? 'success' : 'error'}`}>
                                {cliproxyTestResult.success ? '✅' : '❌'} {cliproxyTestResult.message}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Custom OpenAI Providers Section */}
            <div className="settings-section cliproxy-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 style={{ margin: 0 }}>🌐 Custom OpenAI Compatible Providers</h2>
                    <button className="primary-btn" onClick={() => handleOpenCustomModal()} style={{ padding: '8px 16px', fontSize: '14px', margin: 0 }}>
                        ➕ Add Provider
                    </button>
                </div>
                <p className="section-desc">
                    Thêm các nhà cung cấp AI tương thích chuẩn OpenAI SDK (như ShopAIKey, DeepSeek, local LLMs) để sử dụng cho sinh văn bản và sinh âm thanh TTS.
                </p>

                {customProviders.length === 0 ? (
                    <div className="empty-state" style={{ padding: '24px', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '8px', color: '#888' }}>
                        Chưa cấu hình nhà cung cấp tùy chọn nào. Bấm nút "Add Provider" để thêm.
                    </div>
                ) : (
                    <div className="providers-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {customProviders.map((provider) => (
                            <div key={provider.id} className="provider-item-card" style={{ padding: '16px', border: '1px solid #3d3d3d', borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '12px' }}>
                                    <div>
                                        <h3 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                            {provider.name}
                                            <span className={`status-badge ${provider.enabled ? 'enabled' : 'disabled'}`} style={{ fontSize: '11px', padding: '2px 6px', margin: 0 }}>
                                                {provider.enabled ? 'Enabled' : 'Disabled'}
                                            </span>
                                            {provider.ttsType !== 'none' && (
                                                <span className="status-badge" style={{ fontSize: '11px', padding: '2px 6px', backgroundColor: '#1976d2', color: 'white', margin: 0 }}>
                                                    🎙️ TTS ({provider.ttsType})
                                                </span>
                                            )}
                                        </h3>
                                        <div style={{ fontSize: '13px', color: '#aaa', wordBreak: 'break-all' }}>
                                            <strong>URL:</strong> {provider.url}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button className="secondary-btn" onClick={() => handleTestCustomProvider(provider.id)} disabled={customTestResults[provider.id]?.loading} style={{ padding: '4px 8px', fontSize: '12px', margin: 0 }}>
                                            {customTestResults[provider.id]?.loading ? 'Testing...' : '⚡ Test'}
                                        </button>
                                        <button className="secondary-btn" onClick={() => handleOpenCustomModal(provider)} style={{ padding: '4px 8px', fontSize: '12px', margin: 0 }}>
                                            ✏️ Edit
                                        </button>
                                        <button className="secondary-btn" onClick={() => handleDeleteCustomProvider(provider.id)} style={{ padding: '4px 8px', fontSize: '12px', borderColor: '#d32f2f', color: '#ff6666', margin: 0 }}>
                                            🗑️ Delete
                                        </button>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <label className="toggle-label" style={{ margin: 0, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <input
                                            type="checkbox"
                                            checked={provider.enabled}
                                            onChange={() => handleToggleCustomProvider(provider)}
                                        />
                                        <span>Kích hoạt</span>
                                    </label>
                                </div>

                                {customTestResults[provider.id] && (
                                    <div className={`test-result ${customTestResults[provider.id].success ? 'success' : 'error'}`} style={{ marginTop: '12px', fontSize: '13px', padding: '8px' }}>
                                        {customTestResults[provider.id].success ? '✅' : '❌'} {customTestResults[provider.id].message}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Modal Form */}
                {isCustomModalOpen && (
                    <div className="custom-modal-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                        <div className="custom-modal-content" style={{ width: '90%', maxWidth: '500px', backgroundColor: '#1e1e1e', borderRadius: '8px', border: '1px solid #3d3d3d', padding: '24px', boxSizing: 'border-box' }}>
                            <h3 style={{ marginTop: 0, marginBottom: '20px', borderBottom: '1px solid #3d3d3d', paddingBottom: '10px', color: 'white' }}>
                                {editingCustomId ? '✏️ Edit OpenAI Provider' : '➕ Add Custom OpenAI Provider'}
                            </h3>

                            <div className="setting-group" style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '6px', color: '#ccc' }}>Tên nhà cung cấp</label>
                                <input
                                    type="text"
                                    value={customName}
                                    onChange={(e) => setCustomName(e.target.value)}
                                    placeholder="Ví dụ: ShopAIKey, DeepSeek, LocalLLM..."
                                    style={{ width: '100%', padding: '10px', boxSizing: 'border-box', backgroundColor: '#2a2a2a', color: 'white', border: '1px solid #3d3d3d', borderRadius: '4px' }}
                                />
                            </div>

                            <div className="setting-group" style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '6px', color: '#ccc' }}>Base API URL</label>
                                <input
                                    type="text"
                                    value={customUrl}
                                    onChange={(e) => setCustomUrl(e.target.value)}
                                    placeholder="Ví dụ: https://api.shopaikey.com hoặc http://localhost:8000"
                                    style={{ width: '100%', padding: '10px', boxSizing: 'border-box', backgroundColor: '#2a2a2a', color: 'white', border: '1px solid #3d3d3d', borderRadius: '4px' }}
                                />
                            </div>

                            <div className="setting-group" style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '6px', color: '#ccc' }}>API Key</label>
                                <input
                                    type="password"
                                    value={customApiKey}
                                    onChange={(e) => setCustomApiKey(e.target.value)}
                                    placeholder={editingCustomId ? 'Nhập API key mới để cập nhật' : 'Nhập API key'}
                                    style={{ width: '100%', padding: '10px', boxSizing: 'border-box', backgroundColor: '#2a2a2a', color: 'white', border: '1px solid #3d3d3d', borderRadius: '4px' }}
                                />
                            </div>

                            <div className="setting-group" style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '6px', color: '#ccc' }}>Cấu hình TTS (Text-to-Speech)</label>
                                <select
                                    value={customTtsType}
                                    onChange={(e) => setCustomTtsType(e.target.value as any)}
                                    style={{ width: '100%', padding: '10px', boxSizing: 'border-box', backgroundColor: '#2a2a2a', color: 'white', border: '1px solid #3d3d3d', borderRadius: '4px' }}
                                >
                                    <option value="none">Không hỗ trợ TTS</option>
                                    <option value="openai">OpenAI TTS Standard (/v1/audio/speech)</option>
                                    <option value="shopaikey">ShopAIKey Custom TTS (Google/OpenAI REST API)</option>
                                </select>
                                <p className="help-text" style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                    Chọn cách nhà cung cấp xử lý việc sinh giọng nói. ShopAIKey sử dụng API trả về URL file S3.
                                </p>
                            </div>

                            <div className="setting-group" style={{ marginBottom: '20px' }}>
                                <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="checkbox"
                                        checked={customEnabled}
                                        onChange={(e) => setCustomEnabled(e.target.checked)}
                                    />
                                    <span>Kích hoạt nhà cung cấp</span>
                                </label>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button className="secondary-btn" onClick={() => setIsCustomModalOpen(false)} style={{ margin: 0 }}>
                                    Hủy
                                </button>
                                <button className="primary-btn" onClick={handleSaveCustomProvider} style={{ margin: 0 }}>
                                    Lưu lại
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Image Gen (Flux/ComfyUI) Section */}
            <div className="settings-section cliproxy-section">
                <h2>🎨 Image Generation (Flux/ComfyUI)</h2>
                <p className="section-desc">
                    Configure a local or remote image generation provider using OpenAI Images API compatible endpoints.
                </p>

                <div className="setting-group">
                    <label className="toggle-label">
                        <input
                            type="checkbox"
                            checked={imageGenEnabled}
                            onChange={(e) => setImageGenEnabled(e.target.checked)}
                        />
                        <span>Enable Image Gen</span>
                        {imageGenEnabled && <span className="status-badge enabled">Active</span>}
                        {!imageGenEnabled && <span className="status-badge disabled">Disabled</span>}
                    </label>
                    <p className="help-text">
                        When enabled, image generation will use this provider (Flux, ComfyUI)
                    </p>
                </div>

                {imageGenEnabled && (
                    <>
                        <div className="setting-group">
                            <label htmlFor="imagegen-url">API URL</label>
                            <input
                                id="imagegen-url"
                                type="text"
                                value={imageGenUrl}
                                onChange={(e) => setImageGenUrl(e.target.value)}
                                placeholder="http://117.0.36.6:8000/v1/images/generations"
                            />
                            <p className="help-text">Current: {imageGenConfig?.url || 'Not set'}</p>
                        </div>

                        <div className="setting-group">
                            <label htmlFor="imagegen-apikey">API Key</label>
                            <input
                                id="imagegen-apikey"
                                type="password"
                                value={imageGenApiKey}
                                onChange={(e) => setImageGenApiKey(e.target.value)}
                                placeholder="Enter new API key to update"
                            />
                            <p className="help-text">
                                Current: {imageGenConfig?.apiKey || 'Not set'}
                            </p>
                        </div>

                        <div className="setting-group">
                            <label htmlFor="imagegen-model">🧠 Model Name</label>
                            <input
                                id="imagegen-model"
                                type="text"
                                value={imageGenModel}
                                onChange={(e) => setImageGenModel(e.target.value)}
                                placeholder="flux-image"
                            />
                            <p className="help-text">Tên model gửi trong request (ví dụ: flux-image, flux-dev, flux-schnell)</p>
                        </div>

                        <div className="setting-group">
                            <label htmlFor="imagegen-steps">⚡ Steps</label>
                            <input
                                id="imagegen-steps"
                                type="number"
                                min={1}
                                max={100}
                                value={imageGenSteps}
                                onChange={(e) => setImageGenSteps(Number(e.target.value))}
                            />
                            <p className="help-text">Số bước diffusion (20 là mặc định, nhiều hơn = chất lượng cao hơn nhưng chậm hơn)</p>
                        </div>

                        <div className="button-group">
                            <button
                                className="secondary-btn"
                                onClick={handleTestImageGen}
                                disabled={isTestingImageGen}
                            >
                                {isTestingImageGen ? '⏳ Testing...' : '🔍 Test Connection'}
                            </button>
                            <button
                                className="primary-btn"
                                onClick={handleSaveImageGen}
                                disabled={isSavingImageGen}
                            >
                                {isSavingImageGen ? 'Saving...' : 'Save Image Gen Settings'}
                            </button>
                        </div>

                        {imageGenTestResult && (
                            <div className={`test-result ${imageGenTestResult.success ? 'success' : 'error'}`}>
                                {imageGenTestResult.success ? '✅' : '❌'} {imageGenTestResult.message}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ViTTS System Config Section (Multi-Server) */}
            <div className="settings-section cliproxy-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                        <h2>🎙️ Quản lý Đa Máy Chủ ViTTS (Multi-Server ViTTS)</h2>
                        <p className="section-desc" style={{ marginBottom: 0 }}>
                            Quản lý danh sách các máy chủ GPU / LAN ViTTS (VieNeu-TTS / OmniVoice). Hệ thống tự động quét và phân chia giọng đọc theo từng máy chủ ở Bước 4.
                        </p>
                    </div>
                    <button
                        className="primary-btn"
                        onClick={() => handleOpenVittsModal()}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                    >
                        <span>+</span> Thêm Máy Chủ ViTTS
                    </button>
                </div>

                {isLoadingVittsServers ? (
                    <p style={{ color: '#888' }}>⏳ Đang tải danh sách máy chủ ViTTS...</p>
                ) : vittsServers.length === 0 ? (
                    <div style={{ padding: '24px', backgroundColor: '#1a1a1a', borderRadius: '8px', border: '1px dashed #333', textAlign: 'center', color: '#888' }}>
                        Chưa có máy chủ ViTTS nào được cấu hình. Bấm nút <strong>+ Thêm Máy Chủ ViTTS</strong> để bắt đầu.
                    </div>
                ) : (
                    <div className="table-responsive" style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #333', color: '#888', fontSize: '13px' }}>
                                    <th style={{ padding: '12px 8px' }}>Tên Máy Chủ</th>
                                    <th style={{ padding: '12px 8px' }}>Base URL</th>
                                    <th style={{ padding: '12px 8px' }}>API Key</th>
                                    <th style={{ padding: '12px 8px' }}>Trạng Thái</th>
                                    <th style={{ padding: '12px 8px' }}>Kiểm Tra Kết Nối</th>
                                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>Thao Tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {vittsServers.map((server) => (
                                    <tr key={server.id} style={{ borderBottom: '1px solid #222' }}>
                                        <td style={{ padding: '12px 8px', fontWeight: 600, color: '#eee' }}>
                                            🎙️ {server.name}
                                        </td>
                                        <td style={{ padding: '12px 8px', color: '#aaa', fontFamily: 'monospace', fontSize: '12px' }}>
                                            {server.baseUrl}
                                        </td>
                                        <td style={{ padding: '12px 8px', color: '#666', fontFamily: 'monospace', fontSize: '12px' }}>
                                            {server.apiKey || '(Trống)'}
                                        </td>
                                        <td style={{ padding: '12px 8px' }}>
                                            <button
                                                onClick={() => handleToggleViTTSServer(server)}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    padding: '4px 8px',
                                                    borderRadius: '12px',
                                                    fontSize: '12px',
                                                    fontWeight: 500,
                                                    backgroundColor: server.enabled ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                    color: server.enabled ? '#22c55e' : '#ef4444',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}
                                            >
                                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: server.enabled ? '#22c55e' : '#ef4444' }}></span>
                                                {server.enabled ? 'Kích hoạt' : 'Tắt'}
                                            </button>
                                        </td>
                                        <td style={{ padding: '12px 8px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <button
                                                    className="secondary-btn"
                                                    style={{ padding: '4px 10px', fontSize: '12px', margin: 0, width: 'fit-content' }}
                                                    onClick={() => handleTestViTTSServer(server.id)}
                                                    disabled={vittsServerTestResults[server.id]?.loading}
                                                >
                                                    {vittsServerTestResults[server.id]?.loading ? '⏳ Đang test...' : '🔍 Test'}
                                                </button>
                                                {vittsServerTestResults[server.id] && !vittsServerTestResults[server.id]?.loading && (
                                                    <span style={{
                                                        fontSize: '11px',
                                                        color: vittsServerTestResults[server.id].success ? '#22c55e' : '#ef4444',
                                                        marginTop: '2px'
                                                    }}>
                                                        {vittsServerTestResults[server.id].message}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                                            <div style={{ display: 'inline-flex', gap: '8px' }}>
                                                <button
                                                    className="secondary-btn"
                                                    style={{ padding: '4px 8px', fontSize: '12px', margin: 0 }}
                                                    onClick={() => handleOpenVittsModal(server)}
                                                    title="Chỉnh sửa"
                                                >
                                                    ✏️ Sửa
                                                </button>
                                                <button
                                                    className="secondary-btn"
                                                    style={{ padding: '4px 8px', fontSize: '12px', margin: 0, color: '#ef4444', borderColor: '#ef4444' }}
                                                    onClick={() => handleDeleteViTTSServer(server.id, server.name)}
                                                    title="Xóa"
                                                >
                                                    🗑️ Xóa
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Modal Thêm / Sửa Máy Chủ ViTTS */}
                {isVittsModalOpen && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.75)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        backdropFilter: 'blur(4px)'
                    }}>
                        <div style={{
                            backgroundColor: '#1e1e1e',
                            borderRadius: '12px',
                            padding: '24px',
                            width: '100%',
                            maxWidth: '520px',
                            border: '1px solid #333',
                            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
                        }}>
                            <h3 style={{ marginTop: 0, marginBottom: '16px', color: '#fff', fontSize: '18px' }}>
                                {editingVittsServerId ? '✏️ Chỉnh Sửa Máy Chủ ViTTS' : '➕ Thêm Máy Chủ ViTTS Mới'}
                            </h3>

                            <div className="setting-group" style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '6px', color: '#ccc' }}>Tên Máy Chủ (Gợi nhớ)</label>
                                <input
                                    type="text"
                                    value={vittsFormName}
                                    onChange={(e) => setVittsFormName(e.target.value)}
                                    placeholder="VD: ViTTS Lab GPU 1, ViTTS Cloud VPS..."
                                    style={{ width: '100%', padding: '10px', boxSizing: 'border-box', backgroundColor: '#2a2a2a', color: 'white', border: '1px solid #3d3d3d', borderRadius: '4px' }}
                                />
                            </div>

                            <div className="setting-group" style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '6px', color: '#ccc' }}>Base URL Máy Chủ</label>
                                <input
                                    type="text"
                                    value={vittsFormBaseUrl}
                                    onChange={(e) => setVittsFormBaseUrl(e.target.value)}
                                    placeholder="VD: http://10.64.11.16:8888 hoặc http://117.0.36.6:8888"
                                    style={{ width: '100%', padding: '10px', boxSizing: 'border-box', backgroundColor: '#2a2a2a', color: 'white', border: '1px solid #3d3d3d', borderRadius: '4px' }}
                                />
                            </div>

                            <div className="setting-group" style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '6px', color: '#ccc' }}>
                                    API Key {editingVittsServerId && '(để trống nếu không đổi)'}
                                </label>
                                <input
                                    type="password"
                                    value={vittsFormApiKey}
                                    onChange={(e) => setVittsFormApiKey(e.target.value)}
                                    placeholder="vneu_..."
                                    style={{ width: '100%', padding: '10px', boxSizing: 'border-box', backgroundColor: '#2a2a2a', color: 'white', border: '1px solid #3d3d3d', borderRadius: '4px' }}
                                />
                            </div>

                            <div className="setting-group" style={{ marginBottom: '20px' }}>
                                <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="checkbox"
                                        checked={vittsFormEnabled}
                                        onChange={(e) => setVittsFormEnabled(e.target.checked)}
                                    />
                                    <span>Kích hoạt máy chủ này</span>
                                </label>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button className="secondary-btn" onClick={() => setIsVittsModalOpen(false)} style={{ margin: 0 }}>
                                    Hủy
                                </button>
                                <button className="primary-btn" onClick={handleSaveViTTSServer} style={{ margin: 0 }}>
                                    Lưu Lại
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* SMTP Config Section */}
            <div className="settings-section cliproxy-section">
                <h2>📧 SMTP Email Configuration</h2>
                <p className="section-desc">
                    Cấu hình máy chủ gửi thư SMTP để phục vụ tính năng Quên mật khẩu và Khôi phục tài khoản.
                </p>

                <div className="setting-group">
                    <label className="toggle-label">
                        <input
                            type="checkbox"
                            checked={smtpEnabled}
                            onChange={(e) => setSmtpEnabled(e.target.checked)}
                        />
                        <span>Kích hoạt SMTP</span>
                        {smtpEnabled && <span className="status-badge enabled">Hoạt động</span>}
                        {!smtpEnabled && <span className="status-badge disabled">Tắt</span>}
                    </label>
                </div>

                {smtpEnabled && (
                    <>
                        <div className="form-row" style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                            <div className="setting-group" style={{ flex: 3, marginBottom: 0 }}>
                                <label htmlFor="smtp-host">SMTP Host</label>
                                <input
                                    id="smtp-host"
                                    type="text"
                                    value={smtpHost}
                                    onChange={(e) => setSmtpHost(e.target.value)}
                                    placeholder="VD: smtp.gmail.com"
                                />
                            </div>
                            <div className="setting-group" style={{ flex: 1, marginBottom: 0 }}>
                                <label htmlFor="smtp-port">Port</label>
                                <input
                                    id="smtp-port"
                                    type="text"
                                    value={smtpPort}
                                    onChange={(e) => setSmtpPort(e.target.value)}
                                    placeholder="587"
                                />
                            </div>
                        </div>

                        <div className="form-row" style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                            <div className="setting-group" style={{ flex: 1, marginBottom: 0 }}>
                                <label htmlFor="smtp-user">Username / Email</label>
                                <input
                                    id="smtp-user"
                                    type="text"
                                    value={smtpUser}
                                    onChange={(e) => setSmtpUser(e.target.value)}
                                    placeholder="VD: user@gmail.com"
                                />
                            </div>
                            <div className="setting-group" style={{ flex: 1, marginBottom: 0 }}>
                                <label htmlFor="smtp-pass">Password</label>
                                <input
                                    id="smtp-pass"
                                    type="password"
                                    value={smtpPass}
                                    onChange={(e) => setSmtpPass(e.target.value)}
                                    placeholder="Nhập mật khẩu (hoặc App Password)"
                                />
                            </div>
                        </div>

                        <div className="setting-group">
                            <label htmlFor="smtp-from">Email gửi từ (Sender Email / Name)</label>
                            <input
                                id="smtp-from"
                                type="text"
                                value={smtpFrom}
                                onChange={(e) => setSmtpFrom(e.target.value)}
                                placeholder='VD: "AI Teaching Assistant" <sender@gmail.com>'
                            />
                            <p className="help-text">Định dạng chuẩn: "Tên hiển thị" &lt;email@gmail.com&gt;</p>
                        </div>

                        <div className="button-group">
                            <button
                                className="secondary-btn"
                                onClick={handleTestSMTP}
                                disabled={isTestingSmtp}
                            >
                                {isTestingSmtp ? '⏳ Đang thử...' : '🔍 Gửi Email Test'}
                            </button>
                            <button
                                className="primary-btn"
                                onClick={handleSaveSMTP}
                                disabled={isSavingSmtp}
                            >
                                {isSavingSmtp ? 'Đang lưu...' : 'Lưu Cấu Hình SMTP'}
                            </button>
                        </div>

                        {smtpTestResult && (
                            <div className={`test-result ${smtpTestResult.success ? 'success' : 'error'}`}>
                                {smtpTestResult.success ? '✅' : '❌'} {smtpTestResult.message}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* API Keys Section */}
            <div className="settings-section">
                <h2>🔑 API Keys</h2>

                {message && (
                    <div className={`message-banner ${message.includes('Failed') ? 'error' : 'success'}`}>
                        {message}
                    </div>
                )}

                <div className="setting-group">
                    <label htmlFor="gemini-key">
                        Gemini API Key
                        {settings?.hasGeminiKey && <span className="configured-badge">✓ Configured</span>}
                    </label>
                    <input
                        id="gemini-key"
                        type="password"
                        value={geminiKey}
                        onChange={(e) => setGeminiKey(e.target.value)}
                        placeholder={settings?.hasGeminiKey ? 'Enter new key to update' : 'Enter your Gemini API key'}
                    />
                    <p className="help-text">
                        {cliproxyEnabled
                            ? 'Used as fallback when CLIProxy is unavailable'
                            : 'Required for AI content generation'}
                    </p>
                </div>

                <div className="setting-group">
                    <label htmlFor="encryption-key">
                        Encryption Key
                        {settings?.hasEncryptionKey && <span className="configured-badge">✓ Configured</span>}
                    </label>
                    <input
                        id="encryption-key"
                        type="password"
                        value={encryptionKey}
                        onChange={(e) => setEncryptionKey(e.target.value)}
                        placeholder={settings?.hasEncryptionKey ? 'Enter new key to update' : 'Enter encryption key (min 16 chars)'}
                    />
                    <p className="help-text">Used for encrypting user credentials</p>
                </div>

                <button
                    className="primary-btn"
                    onClick={handleSave}
                    disabled={isSaving || (!geminiKey && !encryptionKey)}
                >
                    {isSaving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>
            
            {/* Useful Links Admin Section */}
            <UsefulLinksAdmin />
        </div>
    );
}
