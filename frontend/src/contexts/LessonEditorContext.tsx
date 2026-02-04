import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '../lib/api';

export interface LessonData {
    id: string;
    title: string;
    subjectId: string;
    outlineRaw: string | null;
    detailedOutline: string | null;
    slideScript: string | null;
    currentStep: number;
    status: string;
}

interface LessonEditorContextType {
    lessonId: string;
    lessonData: LessonData | null;
    isLoading: boolean;
    error: string | null;
    currentStep: number;
    stepMountCounter: number;
    setCurrentStep: (step: number) => void;
    refreshLessonData: () => Promise<void>;
    updateOutlineRaw: (raw: string) => Promise<void>;
    updateDetailedOutline: (detailed: string) => Promise<void>;
    updateSlideScript: (script: string) => Promise<void>;
}

const LessonEditorContext = createContext<LessonEditorContextType | null>(null);

interface LessonEditorProviderProps {
    lessonId: string;
    children: ReactNode;
}

export function LessonEditorProvider({ lessonId, children }: LessonEditorProviderProps) {
    const [lessonData, setLessonData] = useState<LessonData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentStep, setCurrentStepInternal] = useState(1);
    const [stepMountCounter, setStepMountCounter] = useState(0);

    // Wrap setCurrentStep to also increment mount counter
    const setCurrentStep = (step: number) => {
        setCurrentStepInternal(step);
        setStepMountCounter(prev => prev + 1);
    };

    const fetchLessonData = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);

            // Fetch basic lesson info
            const lessonRes = await api.get(`/lessons/${lessonId}`);

            // Fetch outline data
            const outlineRes = await api.get(`/lessons/${lessonId}/outline`);

            // slideScript is on lesson, not from slides endpoint
            const data: LessonData = {
                id: lessonRes.data.id,
                title: lessonRes.data.title,
                subjectId: lessonRes.data.subjectId,
                outlineRaw: outlineRes.data.rawOutline,
                detailedOutline: outlineRes.data.detailedOutline,
                slideScript: lessonRes.data.slideScript, // Get from lesson, not slides endpoint
                currentStep: outlineRes.data.currentStep || 1,
                status: lessonRes.data.status,
            };

            setLessonData(data);
            setCurrentStep(data.currentStep);
        } catch (err: any) {
            console.error('Error fetching lesson data:', err);
            setError(err.response?.data?.message || 'Failed to load lesson data');
        } finally {
            setIsLoading(false);
        }
    }, [lessonId]);

    useEffect(() => {
        fetchLessonData();
    }, [fetchLessonData]);

    const updateOutlineRaw = async (raw: string) => {
        try {
            await api.put(`/lessons/${lessonId}/outline/raw`, { rawOutline: raw });
            await fetchLessonData();
        } catch (err: any) {
            throw new Error(err.response?.data?.message || 'Failed to save outline');
        }
    };

    const updateDetailedOutline = async (detailed: string) => {
        try {
            await api.put(`/lessons/${lessonId}/outline/detailed`, { detailedOutline: detailed });
            await fetchLessonData();
        } catch (err: any) {
            throw new Error(err.response?.data?.message || 'Failed to save detailed outline');
        }
    };

    const updateSlideScript = async (script: string) => {
        try {
            await api.put(`/lessons/${lessonId}/slides/script`, { slideScript: script });
            await fetchLessonData();
        } catch (err: any) {
            throw new Error(err.response?.data?.message || 'Failed to save slide script');
        }
    };

    const value: LessonEditorContextType = {
        lessonId,
        lessonData,
        isLoading,
        error,
        currentStep,
        stepMountCounter,
        setCurrentStep,
        refreshLessonData: fetchLessonData,
        updateOutlineRaw,
        updateDetailedOutline,
        updateSlideScript,
    };

    return (
        <LessonEditorContext.Provider value={value}>
            {children}
        </LessonEditorContext.Provider>
    );
}

export function useLessonEditor() {
    const context = useContext(LessonEditorContext);
    if (!context) {
        throw new Error('useLessonEditor must be used within LessonEditorProvider');
    }
    return context;
}
