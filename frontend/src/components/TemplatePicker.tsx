import { useState, useEffect } from 'react';
import { templatesApi, type PPTXTemplate } from '../lib/templates-api';
import './TemplatePicker.css';

interface TemplatePickerProps {
    selectedId?: string;
    onSelect: (template: PPTXTemplate) => void;
}

export function TemplatePicker({ selectedId, onSelect }: TemplatePickerProps) {
    const [templates, setTemplates] = useState<PPTXTemplate[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadTemplates();
    }, []);

    const loadTemplates = async () => {
        try {
            const response = await templatesApi.getAll();
            setTemplates(response.data);

            // Auto-select default if none selected
            if (!selectedId && response.data.length > 0) {
                const defaultTpl = response.data.find(t => t.isDefault) || response.data[0];
                onSelect(defaultTpl);
            }
        } catch (err) {
            console.error('Failed to load templates', err);
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return <div className="template-picker loading">Loading templates...</div>;
    }

    if (templates.length === 0) {
        return <div className="template-picker empty">No templates available</div>;
    }

    return (
        <div className="template-picker">
            <h3>📊 Select Template</h3>
            <div className="templates-grid">
                {templates.map((template) => (
                    <div
                        key={template.id}
                        className={`template-card ${selectedId === template.id ? 'selected' : ''}`}
                        onClick={() => onSelect(template)}
                    >
                        <div className="template-preview">
                            {template.thumbnailUrl ? (
                                <img src={template.thumbnailUrl} alt={template.name} />
                            ) : (
                                <div className="template-placeholder">
                                    <span>📄</span>
                                </div>
                            )}
                        </div>
                        <div className="template-info">
                            <span className="template-name">{template.name}</span>
                            {template.isDefault && <span className="default-badge">Default</span>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
