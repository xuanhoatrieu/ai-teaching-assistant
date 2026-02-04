import { api, API_BASE_URL } from './api';

export interface PPTXTemplate {
    id: string;
    name: string;
    description?: string;
    titleBgUrl: string;
    contentBgUrl: string;
    thumbnailUrl?: string;
    fileUrl?: string;  // Path to uploaded PPTX file
    stylingJson?: string;
    isSystem: boolean;
    isDefault: boolean;
    isActive: boolean;
    createdAt: string;
}

// User endpoints
export const templatesApi = {
    getAll: () => api.get<PPTXTemplate[]>('/templates'),
    getOne: (id: string) => api.get<PPTXTemplate>(`/templates/${id}`),
    getDefault: () => api.get<PPTXTemplate>('/templates/default'),
};

// Admin endpoints
export const adminTemplatesApi = {
    getAll: () => api.get<PPTXTemplate[]>('/admin/templates'),
    create: (data: Partial<PPTXTemplate>) => api.post<PPTXTemplate>('/admin/templates', data),
    update: (id: string, data: Partial<PPTXTemplate>) => api.put<PPTXTemplate>(`/admin/templates/${id}`, data),
    delete: (id: string) => api.delete(`/admin/templates/${id}`),
    toggle: (id: string) => api.post<PPTXTemplate>(`/admin/templates/${id}/toggle`),

    // Upload PPTX template file
    upload: (formData: FormData) => {
        const token = localStorage.getItem('accessToken');
        return fetch(`${API_BASE_URL}/admin/templates/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
            body: formData,
        }).then(res => {
            if (!res.ok) throw new Error('Upload failed');
            return res.json();
        });
    },
};

