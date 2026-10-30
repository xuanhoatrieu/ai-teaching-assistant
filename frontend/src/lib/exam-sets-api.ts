import { api } from './api';

export interface ExamLessonOverviewItem {
    id: string;
    syllabusLessonId?: string | null;
    lessonId?: string | null;
    originType?: 'bridged' | 'syllabus' | 'lesson' | 'pptx';
    order: number;
    title: string;
    displayTitle?: string;
    hasContent: boolean;
    contentSummary: string;
    sourceBadges?: string[];
    slideCount: number;
    reviewQuestionCount: number;
    englishQuestionCount: number;
    interactiveQuestionCount?: number;
    questionBankTotal?: number;
}

export interface ExamLessonsOverviewResponse {
    subjectName: string;
    isEnglishSubject: boolean;
    lessons: ExamLessonOverviewItem[];
}

export interface GenerateExamSetPayload {
    name: string;
    categoryName?: string;
    subjectId?: string;
    pptxSubjectId?: string;
    mode: 'REVIEW' | 'ENGLISH';
    lessonIds: string[];
    totalCount?: number;
    level1?: number;
    level2?: number;
    level3?: number;
    perLessonCounts?: Record<string, number>;
    questionTypes?: string[];
    subDiscipline?: string;
    customInstructions?: string;
    modelName?: string;
}

export interface ExamSetSummary {
    id: string;
    subjectId?: string | null;
    pptxSubjectId?: string | null;
    name: string;
    title: string;
    categoryName: string;
    mode: 'REVIEW' | 'ENGLISH';
    lessonIds: string[];
    lessonCount: number;
    questionCount: number;
    config: any;
    createdAt: string;
    updatedAt: string;
}

export interface ExamSetDetail extends ExamSetSummary {
    questions: any[];
}

export const examSetsApi = {
    getLessonsOverview: (params: { subjectId?: string; pptxSubjectId?: string }) =>
        api.get<ExamLessonsOverviewResponse>('/exam-sets/lessons-overview', { params }),

    list: (params: { subjectId?: string; pptxSubjectId?: string }) =>
        api.get<ExamSetSummary[]>('/exam-sets', { params }),

    getOne: (id: string) =>
        api.get<ExamSetDetail>(`/exam-sets/${id}`),

    generateAsync: (data: GenerateExamSetPayload) =>
        api.post<{ jobId: string; status: string }>('/exam-sets/generate-async', data),

    appendAsync: (id: string, data: Partial<GenerateExamSetPayload>) =>
        api.post<{ jobId: string; status: string }>(`/exam-sets/${id}/append-async`, data),

    update: (id: string, data: { name?: string; categoryName?: string; questions?: any[] }) =>
        api.put<ExamSetDetail>(`/exam-sets/${id}`, data),

    delete: (id: string) =>
        api.delete<{ deleted: boolean }>(`/exam-sets/${id}`),

    exportMoodleXml: (id: string) =>
        api.get(`/exam-sets/${id}/export/moodle-xml`, { responseType: 'blob' }),

    exportExcel: (id: string) =>
        api.get(`/exam-sets/${id}/export/excel`, { responseType: 'blob' }),
};
