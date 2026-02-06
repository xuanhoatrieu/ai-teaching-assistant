import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import './ModelSelector.css';

type TaskType = 'OUTLINE' | 'SLIDES' | 'QUESTIONS' | 'IMAGE' | 'TTS';

interface AvailableModel {
    name: string;
    displayName: string;
    description?: string;
    supportedTasks: string[];
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
                if (finalConfig.provider === 'CLIPROXY' && !modelName.startsWith('cliproxy:')) {
                    modelName = `cliproxy:${modelName}`;
                }
                setSelectedModel(modelName);
                // Create display name from model name
                const displayName = modelName
                    .replace('cliproxy:', '🌐 ')
                    .replace('gemini-', 'Gemini ')
                    .replace('-', ' ');
                setSelectedModelDisplay(displayName);
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

            // Get models from both GEMINI and CLIPROXY
            const geminiModels = modelsRes.data.models?.GEMINI || [];
            const cliproxyModels = modelsRes.data.models?.CLIPROXY || [];

            // Merge and filter models that support this task
            const allModels = [...geminiModels, ...cliproxyModels];
            const filteredModels = allModels.filter((m: AvailableModel) =>
                m.supportedTasks.includes(taskType)
            );

            // Sort: put selected model first, then alphabetically
            const sortedModels = filteredModels.sort((a, b) => {
                const aIsSelected = a.name === selectedModel;
                const bIsSelected = b.name === selectedModel;
                if (aIsSelected && !bIsSelected) return -1;
                if (!aIsSelected && bIsSelected) return 1;
                return a.displayName.localeCompare(b.displayName);
            });

            setAvailableModels(sortedModels);
            hasLoadedModels.current = true;

            // Update display name from discovered models
            const currentModel = sortedModels.find(m => m.name === selectedModel);
            if (currentModel) {
                setSelectedModelDisplay(currentModel.displayName);
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
        const provider = model.name.startsWith('cliproxy:') ? 'CLIPROXY' :
            model.name.startsWith('vbee:') ? 'VBEE' :
                model.name.startsWith('google-tts:') ? 'GOOGLE_TTS' : 'GEMINI';

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
                                    <div className="model-name">{model.displayName}</div>
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
