import { api } from './api';

export interface SyllabusBlock {
    id: string;
    syllabusId: string;
    blockType: string;
    title: string;
    content: string;
    metadata: any;
    sortOrder: number;
}

export interface SyllabusReference {
    id: string;
    fileName: string;
    fileUrl: string;
    fileSize: number | null;
    markdownContent: string | null;
    status: string;
    createdAt: string;
}

export interface SyllabusLessonItem {
    id: string;
    sortOrder: number;
    title: string;
    outline: string;
    textbookContent: string | null;
    textbookStatus: string;
    textbookPhase?: string | null;
    textbookPlan?: string | null;
    textbookImages?: Array<{ url: string; caption: string; type: string }> | null;
    lessonId: string | null;
    lesson?: { id: string; title: string; status: string } | null;
}

export interface TextbookStatus {
    phase: string;
    status: string;
    progress: number;
    message: string;
}

export interface Syllabus {
    id: string;
    subjectId: string;
    status: string;
    blocks: SyllabusBlock[];
    references: SyllabusReference[];
    lessons: SyllabusLessonItem[];
}

export const syllabusApi = {
    get: (subjectId: string) =>
        api.get<Syllabus | null>(`/subjects/${subjectId}/syllabus`),

    create: (subjectId: string) =>
        api.post<Syllabus>(`/subjects/${subjectId}/syllabus`),

    updateBlock: (syllabusId: string, blockId: string, data: { title?: string; content?: string; metadata?: any }) =>
        api.put<SyllabusBlock>(`/syllabus/${syllabusId}/blocks/${blockId}`, data),

    updateBlocks: (syllabusId: string, blocks: { id: string; title?: string; content?: string; metadata?: any }[]) =>
        api.put(`/syllabus/${syllabusId}/blocks`, { blocks }),

    importDocx: (subjectId: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post<Syllabus>(`/subjects/${subjectId}/syllabus/import`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 0, // no limit — MarkItDown + AI can be slow
        });
    },

    exportDocx: (subjectId: string) =>
        api.get(`/subjects/${subjectId}/syllabus/export/docx`, { responseType: 'blob' }),

    // References
    uploadReference: (syllabusId: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post(`/syllabus/${syllabusId}/references`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 0,
        });
    },

    listReferences: (syllabusId: string) =>
        api.get<SyllabusReference[]>(`/syllabus/${syllabusId}/references`),

    deleteReference: (syllabusId: string, refId: string) =>
        api.delete(`/syllabus/${syllabusId}/references/${refId}`),

    // Lessons
    generateLessons: (
        syllabusId: string,
        numberOfLessons?: number,
        theoryLessons?: number,
        practiceLessons?: number,
    ) =>
        api.post<SyllabusLessonItem[]>(
            `/syllabus/${syllabusId}/lessons/generate`,
            { numberOfLessons, theoryLessons, practiceLessons },
            { timeout: 0 },
        ),

    reorderLessons: (syllabusId: string, lessonIds: string[]) =>
        api.put<SyllabusLessonItem[]>(`/syllabus/${syllabusId}/lessons/reorder`, { lessonIds }),

    clearLessons: (syllabusId: string) =>
        api.delete(`/syllabus/${syllabusId}/lessons`),

    updateLesson: (syllabusId: string, lessonId: string, data: { title?: string; outline?: string }) =>
        api.put<SyllabusLessonItem>(`/syllabus/${syllabusId}/lessons/${lessonId}`, data),

    createLessonBridge: (syllabusId: string, lessonId: string) =>
        api.post(`/syllabus/${syllabusId}/lessons/${lessonId}/bridge`),

    generateTextbook: (syllabusId: string, lessonId: string) =>
        api.post<SyllabusLessonItem>(`/syllabus/${syllabusId}/lessons/${lessonId}/textbook`, {}, { timeout: 0 }),

    generateTextbookPro: (syllabusId: string, lessonId: string) =>
        api.post<SyllabusLessonItem>(`/syllabus/${syllabusId}/lessons/${lessonId}/textbook-pro`, {}, { timeout: 0 }),

    getTextbookStatus: (syllabusId: string, lessonId: string) =>
        api.get<TextbookStatus>(`/syllabus/${syllabusId}/lessons/${lessonId}/textbook-status`),

    saveTextbookContent: (syllabusId: string, lessonId: string, textbookContent: string) =>
        api.put(`/syllabus/${syllabusId}/lessons/${lessonId}/textbook`, { textbookContent }),

    exportTextbookDocx: (subjectId: string) =>
        api.get(`/subjects/${subjectId}/syllabus/textbook/export/docx`, { responseType: 'blob' }),

    exportSingleLessonDocx: (syllabusId: string, lessonId: string) =>
        api.get(`/syllabus/${syllabusId}/lessons/${lessonId}/export/docx`, { responseType: 'blob' }),
};
