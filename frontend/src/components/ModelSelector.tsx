import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import './ModelSelector.css';

type TaskType = 'OUTLINE' | 'SLIDES' | 'SPEAKER_NOTES' | 'QUESTIONS' | 'IMAGE' | 'TTS';

interface AvailableModel {
    name: string;
    displayName: string;
    description?: string;
    supportedTasks: string[];
    source?: string; // 'CLIProxy' or 'Gemini SDK'
}

interface ModelSelectorProps {
    taskType: TaskType;
    label?: string;
    onChange?: (modelName: string, provider: string) => void;
    compact?: boolean;
}

interface ModelConfig {
    provider: string;
    modelName: string;
}

const TASK_LABELS: Record<TaskType, string> = {
    OUTLINE: '🧠 Model tạo Outline',
    SLIDES: '📝 Model tạo Kịch bản',
    SPEAKER_NOTES: '🎤 Model tạo Lời Giảng',
    QUESTIONS: '❓ Model tạo Câu hỏi',
    IMAGE: '🖼️ Model tạo Hình ảnh',
    TTS: '🔊 Model Text-to-Speech',
};

export function ModelSelector({ taskType, label, onChange, compact = false }: ModelSelectorProps) {
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [selectedModelDisplay, setSelectedModelDisplay] = useState<string>('');
    const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [adminDefaultModel, setAdminDefaultModel] = useState<string>('');
    const hasLoadedModels = useRef(false);

    useEffect(() => {
        // On mount: Only fetch current config (fast)
        fetchCurrentConfig();
    }, [taskType]);

    /**
     * FAST: Only fetch user's current config on mount
     * No discover call - just get the currently selected model
     */
    const fetchCurrentConfig = async () => {
        try {
            setIsLoading(true);
            const configRes = await api.get('/user/model-config');
            const configs = configRes.data.configs as Record<string, ModelConfig>;
            const defaults = configRes.data.defaults as Record<string, ModelConfig>;

            // Priority: User config > Admin default
            const userConfig = configs[taskType];
            const adminDefault = defaults[taskType];
            const finalConfig = userConfig || adminDefault;

            if (finalConfig) {
                let modelName = finalConfig.modelName;
                const isCliproxy = finalConfig.provider === 'CLIPROXY';
                const isCustom = modelName.startsWith('custom_openai:');
                
                if (isCliproxy && !modelName.startsWith('cliproxy:')) {
                    modelName = `cliproxy:${modelName}`;
                }
                setSelectedModel(modelName);
                
                // Create display name with source label
                let sourceLabel = '[Gemini SDK]';
                let cleanName = modelName;
                
                if (isCliproxy) {
                    sourceLabel = '[CLIProxy]';
                    cleanName = modelName.replace('cliproxy:', '');
                } else if (isCustom) {
                    const parts = modelName.split(':');
                    sourceLabel = `[${parts[1].toUpperCase()}]`;
                    cleanName = parts.slice(2).join(':');
                } else if (finalConfig.provider === 'IMAGE_GEN') {
                    sourceLabel = '[ImageGen]';
                }
                
                setSelectedModelDisplay(`${sourceLabel} ${cleanName}`);
            }

            // Track admin default for badge annotation
            if (adminDefault) {
                let defaultName = adminDefault.modelName;
                if (adminDefault.provider === 'CLIPROXY' && !defaultName.startsWith('cliproxy:')) {
                    defaultName = `cliproxy:${defaultName}`;
                }
                setAdminDefaultModel(defaultName);
            }
        } catch (err) {
            console.error('Error fetching model config:', err);
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * LAZY: Discover all available models only when dropdown is opened
     * Called once per session
     */
    const fetchAvailableModels = async () => {
        if (hasLoadedModels.current || isLoadingModels) return;

        try {
            setIsLoadingModels(true);
            const modelsRes = await api.get('/user/model-config/discover');

            const allModels: AvailableModel[] = [];

            // Tag each model with its source for display
            const geminiModels = (modelsRes.data.models?.GEMINI || []).map((m: AvailableModel) => ({
                ...m,
                source: 'Gemini SDK',
            }));
            const cliproxyModels = (modelsRes.data.models?.CLIPROXY || []).map((m: AvailableModel) => ({
                ...m,
                source: 'CLIProxy',
            }));
            const imageGenModels = (modelsRes.data.models?.IMAGE_GEN || []).map((m: AvailableModel) => ({
                ...m,
                source: 'ImageGen',
            }));

            allModels.push(...imageGenModels, ...cliproxyModels, ...geminiModels);

            // Add Custom dynamic models
            Object.keys(modelsRes.data.models || {}).forEach(key => {
                if (['GEMINI', 'CLIPROXY', 'IMAGE_GEN', 'VITTS', 'VBEE'].includes(key)) return;
                
                const list = modelsRes.data.models[key] || [];
                const mapped = list.map((m: AvailableModel) => ({
                    ...m,
                    source: key, // e.g. 'SHOPAIKEY'
                }));
                allModels.push(...mapped);
            });

            // Merge and filter models that support this task
            const filteredModels = allModels.filter((m: AvailableModel) =>
                m.supportedTasks.includes(taskType)
            );

            // Sort: ImageGen first (for IMAGE task), then CLIProxy, then Gemini SDK
            const sortedModels = filteredModels.sort((a, b) => {
                // Selected model always first
                const aIsSelected = a.name === selectedModel;
                const bIsSelected = b.name === selectedModel;
                if (aIsSelected && !bIsSelected) return -1;
                if (!aIsSelected && bIsSelected) return 1;
                // ImageGen before CLIProxy before Gemini SDK
                const sourceOrder = { 'ImageGen': 0, 'CLIProxy': 1, 'Gemini SDK': 2 };
                const aOrder = sourceOrder[a.source as keyof typeof sourceOrder] ?? 3;
                const bOrder = sourceOrder[b.source as keyof typeof sourceOrder] ?? 3;
                if (aOrder !== bOrder) return aOrder - bOrder;
                return a.displayName.localeCompare(b.displayName);
            });

            setAvailableModels(sortedModels);
            hasLoadedModels.current = true;

            // Update display name from discovered models
            const currentModel = sortedModels.find(m => m.name === selectedModel);
            if (currentModel) {
                let sourceLabel = '[Gemini SDK]';
                if (currentModel.source === 'CLIProxy') sourceLabel = '[CLIProxy]';
                else if (currentModel.source && currentModel.source !== 'Gemini SDK' && currentModel.source !== 'ImageGen') {
                    sourceLabel = `[${currentModel.source}]`;
                }
                setSelectedModelDisplay(`${sourceLabel} ${currentModel.displayName}`);
            }
        } catch (err) {
            console.error('Error discovering models:', err);
        } finally {
            setIsLoadingModels(false);
        }
    };

    const handleOpenDropdown = () => {
        if (!isOpen) {
            setIsOpen(true);
            // Lazy load models when dropdown opens
            if (!hasLoadedModels.current) {
                fetchAvailableModels();
            }
        } else {
            setIsOpen(false);
        }
    };

    const handleSelectModel = async (model: AvailableModel) => {
        setSelectedModel(model.name);
        setSelectedModelDisplay(model.displayName);
        setIsOpen(false);

        // Determine provider from model name
        const provider = model.name.startsWith('imagegen:') ? 'IMAGE_GEN' :
            model.name.startsWith('cliproxy:') ? 'CLIPROXY' :
            model.name.startsWith('vbee:') ? 'VBEE' :
            model.name.startsWith('google-tts:') ? 'GOOGLE_TTS' :
            model.name.startsWith('custom_openai:') ? model.name.split(':')[1].toUpperCase() : 'GEMINI';

        // Save to backend
        try {
            await api.post('/user/model-config', {
                taskType,
                provider,
                modelName: model.name,
            });

            if (onChange) {
                onChange(model.name, provider);
            }
        } catch (err) {
            console.error('Error saving model config:', err);
        }
    };

    const getSelectedModelDisplay = () => {
        return selectedModelDisplay || selectedModel || 'Đang tải...';
    };

    if (isLoading) {
        return (
            <div className={`model-selector ${compact ? 'compact' : ''}`}>
                <div className="model-selector-label">{label || TASK_LABELS[taskType]}</div>
                <div className="model-selector-loading">⏳ Đang tải...</div>
            </div>
        );
    }

    return (
        <div className={`model-selector ${compact ? 'compact' : ''}`}>
            <div className="model-selector-label">{label || TASK_LABELS[taskType]}</div>
            <div className="model-selector-dropdown">
                <button
                    className="model-selector-trigger"
                    onClick={handleOpenDropdown}
                >
                    <span className="selected-model">{getSelectedModelDisplay()}</span>
                    <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                    <div className="model-selector-menu">
                        {isLoadingModels ? (
                            <div className="model-loading">⏳ Đang tải danh sách models...</div>
                        ) : availableModels.length === 0 ? (
                            <div className="no-models">Không có model khả dụng</div>
                        ) : (
                            availableModels.map((model) => (
                                <div
                                    key={model.name}
                                    className={`model-option ${model.name === selectedModel ? 'selected' : ''}`}
                                    onClick={() => handleSelectModel(model)}
                                >
                                    <div className="model-name">
                                        <span className="model-source-badge" style={{
                                            color: model.source === 'ImageGen' ? '#ffb74d' : model.source === 'CLIProxy' ? '#4fc3f7' : model.source === 'Gemini SDK' ? '#81c784' : '#e040fb',
                                            fontWeight: 600,
                                            fontSize: '0.8em',
                                            marginRight: '6px',
                                        }}>
                                            [{model.source || 'Gemini SDK'}]
                                        </span>
                                        {model.displayName}
                                        {model.name === adminDefaultModel && (
                                            <span className="admin-default-badge"> ⭐ Mặc định</span>
                                        )}
                                    </div>
                                    {model.description && (
                                        <div className="model-desc">{model.description}</div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
