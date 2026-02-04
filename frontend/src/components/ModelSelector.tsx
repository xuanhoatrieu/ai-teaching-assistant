import { useState, useEffect } from 'react';
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
    const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        fetchModelConfig();
    }, [taskType]);

    const fetchModelConfig = async () => {
        try {
            setIsLoading(true);

            // Fetch user's current config and available models
            const [configRes, modelsRes] = await Promise.all([
                api.get('/user/model-config'),
                api.get('/user/model-config/discover'),
            ]);

            const configs = configRes.data.configs as Record<string, ModelConfig>;
            const defaults = configRes.data.defaults as Record<string, ModelConfig>;

            // Get models from both GEMINI and CLIPROXY
            const geminiModels = modelsRes.data.models?.GEMINI || [];
            const cliproxyModels = modelsRes.data.models?.CLIPROXY || [];

            // Merge and filter models that support this task
            const allModels = [...geminiModels, ...cliproxyModels];
            const filteredModels = allModels.filter((m: AvailableModel) =>
                m.supportedTasks.includes(taskType)
            );

            // Get admin default for this task
            const adminDefault = defaults[taskType];

            // Sort models: put admin default first
            const sortedModels = filteredModels.sort((a, b) => {
                const aIsDefault = a.name === adminDefault?.modelName || a.name === `cliproxy:${adminDefault?.modelName}`;
                const bIsDefault = b.name === adminDefault?.modelName || b.name === `cliproxy:${adminDefault?.modelName}`;
                if (aIsDefault && !bIsDefault) return -1;
                if (!aIsDefault && bIsDefault) return 1;
                return 0;
            });
            setAvailableModels(sortedModels);

            // Debug log
            console.log(`[ModelSelector ${taskType}] defaults:`, defaults);
            console.log(`[ModelSelector ${taskType}] adminDefault:`, adminDefault);
            console.log(`[ModelSelector ${taskType}] sortedModels:`, sortedModels.map(m => m.name));

            // Determine which model to select
            const userConfig = configs[taskType];

            // PRIORITIZE ADMIN DEFAULT from CLIPROXY over old GEMINI user configs
            let finalConfig = adminDefault; // Start with admin default

            if (userConfig && userConfig.provider === 'CLIPROXY') {
                // Keep user config only if they explicitly chose a CLIPROXY model
                finalConfig = userConfig;
                console.log(`[ModelSelector ${taskType}] Using user's CLIPROXY selection`);
            } else if (adminDefault?.provider === 'CLIPROXY') {
                console.log(`[ModelSelector ${taskType}] Admin default is CLIPROXY, overriding old GEMINI config`);
            }

            console.log(`[ModelSelector ${taskType}] finalConfig:`, finalConfig);
            if (finalConfig) {
                // Add cliproxy: prefix if admin default is CLIPROXY but modelName doesn't have prefix
                let modelName = finalConfig.modelName;
                if (finalConfig.provider === 'CLIPROXY' && !modelName.startsWith('cliproxy:')) {
                    modelName = `cliproxy:${modelName}`;
                }
                setSelectedModel(modelName);
            }
        } catch (err) {
            console.error('Error fetching model config:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelectModel = async (model: AvailableModel) => {
        setSelectedModel(model.name);
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
        const model = availableModels.find(m => m.name === selectedModel);
        return model?.displayName || selectedModel || 'Đang tải...';
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
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <span className="selected-model">{getSelectedModelDisplay()}</span>
                    <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                    <div className="model-selector-menu">
                        {availableModels.length === 0 ? (
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
