import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { TTSDictionaryManager } from '../../components/admin/TTSDictionaryManager';
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
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [categorizedModels, setCategorizedModels] = useState<{
        text: { id: string; source: string }[];
        image: { id: string; source: string }[];
        tts: { id: string; source: string }[];
    }>({ text: [], image: [], tts: [] });

    useEffect(() => {
        fetchSettings();
        fetchCLIProxyConfig();
    }, []);

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

            // Fetch available models if enabled
            if (config.enabled) {
                try {
                    const testRes = await api.get('/admin/config/cliproxy/test');
                    if (testRes.data.models) {
                        setAvailableModels(testRes.data.models);
                    }
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
            };
            await api.put('/admin/config/cliproxy', payload);
            setCliproxyApiKey(''); // clear API key after saving

            // Now test with the saved config
            const response = await api.get('/admin/config/cliproxy/test');
            setCliproxyTestResult(response.data);

            if (response.data.models) {
                setAvailableModels(response.data.models);
            }
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
                                placeholder="https://cliproxy.hoclieu.id.vn"
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

            {/* TTS Dictionary Section */}
            <TTSDictionaryManager />
        </div>
    );
}
