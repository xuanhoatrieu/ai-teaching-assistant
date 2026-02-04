import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { lessonsApi, type Lesson, type GeneratedContent } from '../lib/subjects-api';
import { api } from '../lib/api';
import './LessonPreview.css';

export function LessonPreviewPage() {
    const { id } = useParams<{ id: string }>();

    const [lesson, setLesson] = useState<Lesson | null>(null);
    const [contents, setContents] = useState<GeneratedContent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [downloading, setDownloading] = useState<string | null>(null);

    useEffect(() => {
        if (id) fetchData();
    }, [id]);

    const fetchData = async () => {
        try {
            const response = await lessonsApi.getOne(id!);
            setLesson(response.data);
            setContents(response.data.generatedContents || []);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDownload = async (content: GeneratedContent) => {
        if (!content.fileUrl) return;

        setDownloading(content.id);
        try {
            const response = await api.get(content.fileUrl, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.download = getFilename(content);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            setError('Download failed');
        } finally {
            setDownloading(null);
        }
    };

    const getFilename = (content: GeneratedContent) => {
        const baseName = lesson?.title.replace(/[^a-zA-Z0-9]/g, '_') || 'export';
        switch (content.type) {
            case 'PPTX': return `${baseName}.pptx`;
            case 'HANDOUT': return `${baseName}_Handout.docx`;
            case 'QUIZ_EXCEL': return `${baseName}_Quiz.xlsx`;
            case 'QUIZ_WORD': return `${baseName}_Quiz.docx`;
            case 'AUDIO': return `${baseName}_Audio.mp3`;
            default: return 'export';
        }
    };

    const getContentIcon = (type: GeneratedContent['type']) => {
        switch (type) {
            case 'PPTX': return '📊';
            case 'HANDOUT': return '📄';
            case 'QUIZ_EXCEL': return '📗';
            case 'QUIZ_WORD': return '📝';
            case 'AUDIO': return '🔊';
            default: return '📁';
        }
    };

    const getContentLabel = (type: GeneratedContent['type']) => {
        switch (type) {
            case 'PPTX': return 'PowerPoint Slides';
            case 'HANDOUT': return 'Study Handout';
            case 'QUIZ_EXCEL': return 'Quiz (Excel)';
            case 'QUIZ_WORD': return 'Quiz (Word Table)';
            case 'AUDIO': return 'Audio Narration';
            default: return type;
        }
    };

    if (isLoading) {
        return <div className="loading-state">Loading...</div>;
    }

    if (!lesson) {
        return <div className="error-state">Lesson not found</div>;
    }

    return (
        <div className="preview-page">
            <div className="breadcrumb">
                <Link to="/">Subjects</Link>
                <span>/</span>
                <Link to={`/lessons/${id}`}>{lesson.title}</Link>
                <span>/</span>
                <span>Preview & Export</span>
            </div>

            <div className="preview-header">
                <h1>🎉 Content Ready!</h1>
                <p>{lesson.title}</p>
            </div>

            {error && <div className="error-banner">{error}</div>}

            <div className="exports-grid">
                {contents.map((content) => (
                    <div key={content.id} className="export-card">
                        <div className="export-icon">{getContentIcon(content.type)}</div>
                        <div className="export-info">
                            <h3>{getContentLabel(content.type)}</h3>
                            <p>{new Date(content.createdAt).toLocaleString()}</p>
                        </div>
                        <button
                            className="download-btn"
                            onClick={() => handleDownload(content)}
                            disabled={!content.fileUrl || downloading === content.id}
                        >
                            {downloading === content.id ? 'Downloading...' : '⬇️ Download'}
                        </button>
                    </div>
                ))}
            </div>

            {contents.length === 0 && (
                <div className="empty-state">
                    <p>No generated content yet</p>
                    <Link to={`/lessons/${id}`} className="primary-btn">
                        Edit Lesson
                    </Link>
                </div>
            )}

            <div className="preview-actions">
                <Link to={`/lessons/${id}`} className="secondary-btn">
                    ← Edit Lesson
                </Link>
                <Link to="/" className="primary-btn">
                    Back to Subjects
                </Link>
            </div>
        </div>
    );
}
