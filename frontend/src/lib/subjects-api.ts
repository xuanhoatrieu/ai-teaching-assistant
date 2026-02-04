import { api } from './api';

// API functions for subjects and lessons

export interface Subject {
    id: string;
    name: string;
    description?: string;
    // Role definition fields
    institutionType?: string;
    expertiseArea?: string;
    courseName?: string;
    targetAudience?: string;
    majorName?: string;
    additionalContext?: string;
    createdAt: string;
    _count?: { lessons: number };
}

export interface CreateSubjectData {
    name: string;
    description?: string;
    institutionType?: string;
    expertiseArea?: string;
    courseName?: string;
    targetAudience?: string;
    majorName?: string;
    additionalContext?: string;
}

export interface Lesson {
    id: string;
    subjectId: string;
    templateId?: string;
    title: string;
    outlineRaw?: string;
    status: 'DRAFT' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    createdAt: string;
    _count?: { generatedContents: number };
}

export interface GeneratedContent {
    id: string;
    type: 'PPTX' | 'HANDOUT' | 'QUIZ_EXCEL' | 'QUIZ_WORD' | 'AUDIO';
    status: string;
    fileUrl?: string;
    createdAt: string;
}

// Subjects API
export const subjectsApi = {
    getAll: () => api.get<Subject[]>('/subjects'),
    getOne: (id: string) => api.get<Subject & { lessons: Lesson[] }>(`/subjects/${id}`),
    create: (data: CreateSubjectData) => api.post<Subject>('/subjects', data),
    update: (id: string, data: Partial<CreateSubjectData>) => api.put<Subject>(`/subjects/${id}`, data),
    delete: (id: string) => api.delete(`/subjects/${id}`),
};

// Lessons API
export const lessonsApi = {
    getBySubject: (subjectId: string) => api.get<Lesson[]>(`/subjects/${subjectId}/lessons`),
    getOne: (id: string) => api.get<Lesson & { generatedContents: GeneratedContent[] }>(`/lessons/${id}`),
    create: (subjectId: string, data: { title: string; outlineRaw?: string }) =>
        api.post<Lesson>(`/subjects/${subjectId}/lessons`, data),
    update: (id: string, data: { title?: string; outlineRaw?: string; templateId?: string }) =>
        api.put<Lesson>(`/lessons/${id}`, data),
    delete: (id: string) => api.delete(`/lessons/${id}`),
    uploadOutline: (id: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post<Lesson>(`/lessons/${id}/upload-outline`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    generate: (id: string) => api.post(`/lessons/${id}/generate`),
    getStatus: (id: string) => api.get(`/lessons/${id}/status`),
};
