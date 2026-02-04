import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { lessonsApi, type Lesson, type GeneratedContent } from '../lib/subjects-api';
import './LessonProgress.css';

export function LessonProgressPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [lesson, setLesson] = useState<Lesson | null>(null);
    const [contents, setContents] = useState<GeneratedContent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (id) {
            fetchStatus();
            // Poll every 3 seconds if processing
            const interval = setInterval(fetchStatus, 3000);
            return () => clearInterval(interval);
        }
    }, [id]);

    const fetchStatus = async () => {
        try {
            const response = await lessonsApi.getOne(id!);
            setLesson(response.data);
            setContents(response.data.generatedContents || []);

            // If completed, redirect to preview
            if (response.data.status === 'COMPLETED') {
                setTimeout(() => navigate(`/lessons/${id}/preview`), 1500);
            }
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to fetch status');
        } finally {
            setIsLoading(false);
        }
    };

    const getProgressPercent = () => {
        if (!lesson) return 0;
        if (lesson.status === 'DRAFT') return 0;
        if (lesson.status === 'COMPLETED') return 100;
        if (lesson.status === 'FAILED') return 0;
        // Processing - estimate based on contents
        return Math.min(90, contents.length * 25);
    };

    if (isLoading) {
        return <div className="loading-state">Loading...</div>;
    }

    if (!lesson) {
        return <div className="error-state">Lesson not found</div>;
    }

    return (
        <div className="progress-page">
            <div className="breadcrumb">
                <Link to="/">Subjects</Link>
                <span>/</span>
                <Link to={`/lessons/${id}`}>{lesson.title}</Link>
                <span>/</span>
                <span>Progress</span>
            </div>

            <div className="progress-container">
                <div className="progress-header">
                    <h1>
                        {lesson.status === 'PROCESSING' && '⚙️ Generating Content...'}
                        {lesson.status === 'COMPLETED' && '✅ Generation Complete!'}
                        {lesson.status === 'FAILED' && '❌ Generation Failed'}
                        {lesson.status === 'DRAFT' && '📝 Ready to Generate'}
                    </h1>
                    <p className="progress-subtitle">{lesson.title}</p>
                </div>

                {error && <div className="error-banner">{error}</div>}

                <div className="progress-bar-container">
                    <div
                        className="progress-bar"
                        style={{ width: `${getProgressPercent()}%` }}
                    />
                </div>
                <div className="progress-percent">{getProgressPercent()}%</div>

                <div className="generation-steps">
                    <div className={`step ${contents.some(c => c.type === 'PPTX') ? 'done' : lesson.status === 'PROCESSING' ? 'active' : ''}`}>
                        <span className="step-icon">📊</span>
                        <span className="step-label">Generating Slides</span>
                    </div>
                    <div className={`step ${contents.some(c => c.type === 'HANDOUT') ? 'done' : ''}`}>
                        <span className="step-icon">📄</span>
                        <span className="step-label">Creating Handout</span>
                    </div>
                    <div className={`step ${contents.some(c => c.type === 'QUIZ_EXCEL') ? 'done' : ''}`}>
                        <span className="step-icon">❓</span>
                        <span className="step-label">Generating Quiz</span>
                    </div>
                    <div className={`step ${contents.some(c => c.type === 'AUDIO') ? 'done' : ''}`}>
                        <span className="step-icon">🔊</span>
                        <span className="step-label">Creating Audio</span>
                    </div>
                </div>

                {lesson.status === 'COMPLETED' && (
                    <div className="actions">
                        <button
                            className="primary-btn"
                            onClick={() => navigate(`/lessons/${id}/preview`)}
                        >
                            View & Export Results →
                        </button>
                    </div>
                )}

                {lesson.status === 'FAILED' && (
                    <div className="actions">
                        <button
                            className="secondary-btn"
                            onClick={() => navigate(`/lessons/${id}`)}
                        >
                            Edit Outline
                        </button>
                        <button
                            className="primary-btn"
                            onClick={async () => {
                                await lessonsApi.generate(id!);
                                fetchStatus();
                            }}
                        >
                            Retry Generation
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
