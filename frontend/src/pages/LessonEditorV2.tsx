import { useParams, Link } from 'react-router-dom';
import { LessonEditorProvider, useLessonEditor } from '../contexts/LessonEditorContext';
import { WorkflowStepper } from '../components/WorkflowStepper';
import { Step1RawOutline } from '../components/steps/Step1RawOutline';
import { Step2BuildOutline } from '../components/steps/Step2BuildOutline';
import { Step3DesignSlides } from '../components/steps/Step3DesignSlides';
import { Step4GenerateAudio } from '../components/steps/Step4GenerateAudio';
import { Step5GeneratePPTX } from '../components/steps/Step5GeneratePPTX';
import { Step6QuestionBank } from '../components/steps/Step6QuestionBank';
import { api } from '../lib/api';
import './LessonEditorV2.css';

function LessonEditorContent() {
    const { lessonData, isLoading, error, currentStep, setCurrentStep, stepMountCounter } = useLessonEditor();

    const renderStepContent = () => {
        switch (currentStep) {
            case 1:
                return <Step1RawOutline />;
            case 2:
                return <Step2BuildOutline />;
            case 3:
                return <Step3DesignSlides />;
            case 4:
                return <Step4GenerateAudio />;
            case 5:
                // stepMountCounter changes on every step switch, forcing remount to reload data
                return <Step5GeneratePPTX key={`step5-mount-${stepMountCounter}`} />;
            case 6:
                return <Step6QuestionBank />;
            default:
                return <Step1RawOutline />;
        }
    };

    const handleNextStep = async () => {
        // Auto-save detailed outline when leaving Step 2
        if (currentStep === 2 && lessonData?.detailedOutline) {
            try {
                await api.put(`/lessons/${lessonData.id}/outline/detailed`, {
                    detailedOutline: lessonData.detailedOutline
                });
            } catch (err) {
                console.error('Auto-save outline failed:', err);
            }
        }

        // Auto-save slide script when leaving Step 3
        if (currentStep === 3 && lessonData?.slideScript) {
            try {
                await api.put(`/lessons/${lessonData.id}/slides/script`, {
                    slideScript: lessonData.slideScript
                });
            } catch (err) {
                console.error('Auto-save failed:', err);
                // Still allow navigation even if auto-save fails
            }
        }

        if (currentStep < 6) {
            setCurrentStep(currentStep + 1);
        }
    };

    const handlePrevStep = () => {
        if (currentStep > 1) {
            setCurrentStep(currentStep - 1);
        }
    };

    if (isLoading) {
        return (
            <div className="lesson-editor-v2">
                <div className="loading-state">
                    <div className="loading-spinner"></div>
                    <p>Đang tải bài học...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="lesson-editor-v2">
                <div className="error-state">
                    <span className="error-icon">⚠️</span>
                    <p>{error}</p>
                    <Link to="/" className="back-link">← Quay về trang chủ</Link>
                </div>
            </div>
        );
    }

    if (!lessonData) {
        return (
            <div className="lesson-editor-v2">
                <div className="error-state">
                    <span className="error-icon">❓</span>
                    <p>Không tìm thấy bài học</p>
                    <Link to="/" className="back-link">← Quay về trang chủ</Link>
                </div>
            </div>
        );
    }

    // Calculate max step user can access (based on data availability)
    const getMaxStep = () => {
        if (lessonData.slideScript) return 6;
        if (lessonData.detailedOutline) return 4;
        if (lessonData.outlineRaw) return 3;
        return 2;
    };

    return (
        <div className="lesson-editor-v2">
            {/* Header */}
            <header className="editor-header">
                <div className="header-top">
                    <div className="breadcrumb">
                        <Link to="/">📚 Môn học</Link>
                        <span>/</span>
                        <Link to={`/subjects/${lessonData.subjectId}`}>Danh sách bài</Link>
                        <span>/</span>
                        <span className="current">{lessonData.title}</span>
                    </div>
                    <Link to={`/lessons/${lessonData.id}/classic`} className="version-toggle">
                        📋 Classic Editor
                    </Link>
                </div>
                <h1 className="lesson-title">{lessonData.title}</h1>
            </header>

            {/* Workflow Stepper */}
            <WorkflowStepper
                currentStep={currentStep}
                onStepClick={setCurrentStep}
                maxStep={getMaxStep()}
            />

            {/* Step Content */}
            <main className="editor-content">
                {renderStepContent()}
            </main>

            {/* Footer Navigation */}
            <footer className="editor-footer">
                <button
                    className="nav-btn prev"
                    onClick={handlePrevStep}
                    disabled={currentStep === 1}
                >
                    ← Quay lại
                </button>

                <div className="step-indicator">
                    Bước {currentStep}/6
                </div>

                <button
                    className="nav-btn next"
                    onClick={handleNextStep}
                    disabled={currentStep === 6}
                >
                    {currentStep === 6 ? '✓ Hoàn thành' : 'Tiếp theo →'}
                </button>
            </footer>
        </div>
    );
}

export function LessonEditorPageV2() {
    const { id } = useParams<{ id: string }>();

    if (!id) {
        return <div className="error-state">Invalid lesson ID</div>;
    }

    return (
        <LessonEditorProvider lessonId={id}>
            <LessonEditorContent />
        </LessonEditorProvider>
    );
}
