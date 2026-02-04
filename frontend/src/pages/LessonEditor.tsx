import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { lessonsApi, type Lesson } from '../lib/subjects-api';
import { TemplatePicker } from '../components/TemplatePicker';
import { type PPTXTemplate } from '../lib/templates-api';
import './LessonEditor.css';

export function LessonEditorPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [lesson, setLesson] = useState<Lesson | null>(null);
    const [outline, setOutline] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState<PPTXTemplate | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState('');
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        if (id) fetchLesson();
    }, [id]);

    const fetchLesson = async () => {
        try {
            const response = await lessonsApi.getOne(id!);
            setLesson(response.data);
            setOutline(response.data.outlineRaw || '');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load lesson');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await lessonsApi.update(id!, {
                outlineRaw: outline,
                templateId: selectedTemplate?.id,
            });
            setError('');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to save');
        } finally {
            setIsSaving(false);
        }
    };

    const handleFileUpload = async (file: File) => {
        try {
            const response = await lessonsApi.uploadOutline(id!, file);
            setLesson(response.data);
            setOutline(response.data.outlineRaw || '');
            setError('');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to upload file');
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFileUpload(file);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleGenerate = async () => {
        if (!outline.trim()) {
            setError('Please add an outline first');
            return;
        }

        setIsGenerating(true);
        try {
            // Save outline and template first
            await lessonsApi.update(id!, {
                outlineRaw: outline,
                templateId: selectedTemplate?.id,
            });
            // Trigger generation
            await lessonsApi.generate(id!);
            // Navigate to progress page
            navigate(`/lessons/${id}/progress`);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to start generation');
            setIsGenerating(false);
        }
    };

    if (isLoading) {
        return <div className="loading-state">Loading lesson...</div>;
    }

    if (!lesson) {
        return <div className="error-state">Lesson not found</div>;
    }

    return (
        <div className="lesson-editor-page">
            <div className="breadcrumb">
                <Link to="/">Subjects</Link>
                <span>/</span>
                <Link to={`/subjects/${lesson.subjectId}`}>Subject</Link>
                <span>/</span>
                <span>{lesson.title}</span>
            </div>

            <div className="page-header">
                <h1>{lesson.title}</h1>
                <div className="header-actions">
                    <Link to={`/lessons/${id}`} className="version-toggle">
                        ✨ Workflow Editor (V2)
                    </Link>
                    <button className="secondary-btn" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save Draft'}
                    </button>
                    <button
                        className="primary-btn generate-btn"
                        onClick={handleGenerate}
                        disabled={isGenerating || !outline.trim()}
                    >
                        {isGenerating ? 'Starting...' : '🚀 Generate Content'}
                    </button>
                </div>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="editor-container">
                {/* Template Selection */}
                <TemplatePicker
                    selectedId={selectedTemplate?.id}
                    onSelect={setSelectedTemplate}
                />

                <div className="editor-section">
                    <h2>Lesson Outline</h2>
                    <p className="section-description">
                        Paste your outline text or upload a .docx/.md file
                    </p>

                    <div
                        className={`dropzone ${isDragging ? 'dragging' : ''}`}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <span className="dropzone-icon">📄</span>
                        <span className="dropzone-text">
                            Drop .docx or .md file here, or click to browse
                        </span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".docx,.md,.txt"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(file);
                            }}
                            hidden
                        />
                    </div>

                    <div className="divider">
                        <span>or paste text below</span>
                    </div>

                    <textarea
                        className="outline-textarea"
                        value={outline}
                        onChange={(e) => setOutline(e.target.value)}
                        placeholder="Paste your lesson outline here...

Example:
# Introduction to Machine Learning

## 1. What is Machine Learning?
- Definition and overview
- Types: Supervised, Unsupervised, Reinforcement

## 2. Key Concepts
- Training data
- Features and labels
- Model evaluation

## 3. Applications
- Image recognition
- Natural language processing
- Recommendation systems"
                        rows={20}
                    />

                    <div className="outline-stats">
                        <span>{outline.length} characters</span>
                        <span>{outline.split('\n').filter(l => l.trim()).length} lines</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

