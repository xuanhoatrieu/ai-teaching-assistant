import React from 'react';
import './WorkflowStepper.css';

interface Step {
    id: number;
    name: string;
    icon: string;
}

const steps: Step[] = [
    { id: 1, name: 'Nhập Outline', icon: '📝' },
    { id: 2, name: 'Tạo Outline', icon: '📋' },
    { id: 3, name: 'Kịch Bản Slide', icon: '🎨' },
    { id: 4, name: 'Tạo Audio', icon: '🔊' },
    { id: 5, name: 'Tạo PPTX', icon: '📊' },
    { id: 6, name: 'Câu Hỏi', icon: '❓' },
];

interface WorkflowStepperProps {
    currentStep: number;
    onStepClick: (step: number) => void;
    maxStep?: number; // Prevent jumping ahead
}

export function WorkflowStepper({ currentStep, onStepClick, maxStep = 6 }: WorkflowStepperProps) {
    const handleStepClick = (stepId: number) => {
        // Only allow clicking on completed or current steps
        if (stepId <= maxStep) {
            onStepClick(stepId);
        }
    };

    const activeStepObj = steps.find(s => s.id === currentStep) || steps[0];
    const progressPercent = Math.round((currentStep / steps.length) * 100);

    return (
        <div className="workflow-stepper-container">
            {/* Mobile Step Summary Banner */}
            <div className="mobile-step-summary">
                <div className="mobile-step-info">
                    <span className="mobile-step-badge">Bước {currentStep}/{steps.length} ({progressPercent}%)</span>
                    <span className="mobile-step-title">{activeStepObj.icon} {activeStepObj.name}</span>
                </div>
                <div className="mobile-step-progress">
                    <div className="mobile-progress-bar" style={{ width: `${progressPercent}%` }}></div>
                </div>
            </div>

            <div className="workflow-stepper">
                {steps.map((step, idx) => {
                    const isActive = step.id === currentStep;
                    const isCompleted = step.id < currentStep;
                    const isClickable = step.id <= maxStep;

                    return (
                        <React.Fragment key={step.id}>
                            <div
                                className={`step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''} ${!isClickable ? 'disabled' : ''}`}
                                onClick={() => handleStepClick(step.id)}
                                title={step.name}
                            >
                                <div className="step-icon-wrapper">
                                    <span className="step-icon">{step.icon}</span>
                                    {isCompleted && <span className="step-check">✓</span>}
                                </div>
                                <span className="step-name">{step.name}</span>
                            </div>
                            {idx < steps.length - 1 && (
                                <div className={`step-connector ${isCompleted ? 'completed' : ''}`} />
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
}
