import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { subjectsApi, lessonsApi, type Subject, type Lesson, type CreateSubjectData } from '../lib/subjects-api';
import { VideoListPanel } from '../components/VideoListPanel';
import { SyllabusPanel } from '../components/syllabus/SyllabusPanel';
import { syllabusApi, type Syllabus } from '../lib/syllabus-api';
import './SubjectDetail.css';

const INSTITUTION_TYPES = ['Đại học', 'Cao đẳng', 'THPT', 'Doanh nghiệp', 'Khác'];
const LANGUAGE_OPTIONS = [
    { value: 'vi', label: '🇻🇳 Tiếng Việt', desc: 'Toàn bộ nội dung bằng tiếng Việt' },
    { value: 'en', label: '🇬🇧 English', desc: 'All content in English' },
    { value: 'vi-en', label: '🌐 Song ngữ (Bilingual)', desc: 'Slide EN, Speaker Notes VI' },
];

export function SubjectDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [subject, setSubject] = useState<Subject | null>(null);
    const [lessons, setLessons] = useState<Lesson[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<'lessons' | 'videos' | 'syllabus'>('lessons');

    // Create lesson modal
    const [showModal, setShowModal] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [syllabusForDropdown, setSyllabusForDropdown] = useState<Syllabus | null>(null);
    const [selectedSyllabusLessonId, setSelectedSyllabusLessonId] = useState<string>('');

    // Edit lesson modal
    const [showEditLessonModal, setShowEditLessonModal] = useState(false);
    const [editLessonId, setEditLessonId] = useState<string | null>(null);
    const [editLessonTitle, setEditLessonTitle] = useState('');
    const [isEditingSaving, setIsEditingSaving] = useState(false);

    // Delete lesson confirmation modal
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteLessonId, setDeleteLessonId] = useState<string | null>(null);
    const [deleteLessonTitle, setDeleteLessonTitle] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    // Edit subject modal
    const [showEditModal, setShowEditModal] = useState(false);
    const [editForm, setEditForm] = useState<CreateSubjectData>({
        name: '',
        description: '',
        institutionType: 'Đại học',
        expertiseArea: '',
        courseName: '',
        targetAudience: '',
        majorName: '',
        additionalContext: '',
        language: 'vi',
    });

    useEffect(() => {
        if (id) fetchData();
    }, [id]);

    const fetchData = async () => {
        try {
            const [subjectRes, lessonsRes] = await Promise.all([
                subjectsApi.getOne(id!),
                lessonsApi.getBySubject(id!),
            ]);
            setSubject(subjectRes.data);
            setLessons(lessonsRes.data);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load subject');
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenCreateModal = async () => {
        setShowModal(true);
        setNewTitle('');
        setSelectedSyllabusLessonId('');
        try {
            const res = await syllabusApi.get(id!);
            setSyllabusForDropdown(res.data);
        } catch (err) {
            // Syllabus might not exist, ignore
            setSyllabusForDropdown(null);
        }
    };

    const handleCreateLesson = async () => {
        if (!newTitle.trim() && !selectedSyllabusLessonId) return;

        try {
            if (selectedSyllabusLessonId && syllabusForDropdown) {
                // Create from syllabus bridge
                const response = await syllabusApi.createLessonBridge(syllabusForDropdown.id, selectedSyllabusLessonId);
                setShowModal(false);
                setNewTitle('');
                setSelectedSyllabusLessonId('');
                const lessonData = response.data as any;
                navigate(`/lessons/${lessonData.lesson.id}`);
            } else {
                // Create manual lesson
                const response = await lessonsApi.create(id!, { title: newTitle });
                setShowModal(false);
                setNewTitle('');
                navigate(`/lessons/${response.data.id}`);
            }
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to create lesson');
        }
    };

    // ===== Edit Lesson =====
    const openEditLessonModal = (lesson: Lesson) => {
        setEditLessonId(lesson.id);
        setEditLessonTitle(lesson.title);
        setShowEditLessonModal(true);
    };

    const handleSaveEditLesson = async () => {
        if (!editLessonId || !editLessonTitle.trim()) return;
        setIsEditingSaving(true);
        try {
            await lessonsApi.update(editLessonId, { title: editLessonTitle.trim() });
            setShowEditLessonModal(false);
            setEditLessonId(null);
            setEditLessonTitle('');
            fetchData();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Không thể cập nhật bài giảng');
        } finally {
            setIsEditingSaving(false);
        }
    };

    // ===== Delete Lesson =====
    const openDeleteModal = (lesson: Lesson) => {
        setDeleteLessonId(lesson.id);
        setDeleteLessonTitle(lesson.title);
        setShowDeleteModal(true);
    };

    const confirmDeleteLesson = async () => {
        if (!deleteLessonId) return;
        setIsDeleting(true);
        try {
            await lessonsApi.delete(deleteLessonId);
            setShowDeleteModal(false);
            setDeleteLessonId(null);
            setDeleteLessonTitle('');
            fetchData();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Không thể xóa bài giảng');
        } finally {
            setIsDeleting(false);
        }
    };

    const openEditModal = () => {
        if (subject) {
            setEditForm({
                name: subject.name,
                description: subject.description || '',
                institutionType: subject.institutionType || 'Đại học',
                expertiseArea: subject.expertiseArea || '',
                courseName: subject.courseName || '',
                targetAudience: subject.targetAudience || '',
                majorName: subject.majorName || '',
                additionalContext: subject.additionalContext || '',
                language: subject.language || 'vi',
            });
            setShowEditModal(true);
        }
    };

    const handleUpdateSubject = async () => {
        if (!editForm.name.trim()) return;

        try {
            await subjectsApi.update(id!, editForm);
            setShowEditModal(false);
            fetchData();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to update subject');
        }
    };

    const getStatusBadge = (status: Lesson['status']) => {
        const badges = {
            DRAFT: { label: 'Draft', class: 'draft' },
            PROCESSING: { label: 'Processing...', class: 'processing' },
            COMPLETED: { label: 'Completed', class: 'completed' },
            FAILED: { label: 'Failed', class: 'failed' },
        };
        const badge = badges[status];
        return <span className={`status-badge ${badge.class}`}>{badge.label}</span>;
    };

    // Generate role preview text
    const getRolePreview = () => {
        if (!subject) return '';
        return `Giảng viên ${subject.institutionType || 'Đại học'} chuyên ${subject.expertiseArea || subject.name}, dạy môn ${subject.courseName || subject.name} cho ${subject.targetAudience || 'sinh viên'}${subject.majorName ? ` ngành ${subject.majorName}` : ''}.`;
    };

    if (isLoading) {
        return <div className="loading-state">Loading...</div>;
    }

    if (!subject) {
        return <div className="error-state">Subject not found</div>;
    }

    return (
        <div className="subject-detail-page">
            <div className="breadcrumb">
                <Link to="/">Subjects</Link>
                <span>/</span>
                <span>{subject.name}</span>
            </div>

            <div className="page-header">
                <div>
                    <h1>{subject.name}</h1>
                    {subject.description && <p>{subject.description}</p>}
                </div>
                <div className="header-actions">
                    <button className="secondary-btn" onClick={openEditModal}>
                        ✏️ Sửa
                    </button>
                </div>
            </div>

            {/* Role Preview Card */}
            {(subject.institutionType || subject.expertiseArea) && (
                <div className="role-preview-card">
                    <div className="role-preview-header">
                        <span className="role-icon">🎭</span>
                        <span>AI Role Context</span>
                    </div>
                    <p className="role-preview-text">{getRolePreview()}</p>
                    <div className="role-language-badge">
                        {LANGUAGE_OPTIONS.find(o => o.value === (subject.language || 'vi'))?.label || '🇻🇳 Tiếng Việt'}
                    </div>
                    {subject.additionalContext && (
                        <p className="role-additional">📝 {subject.additionalContext}</p>
                    )}
                </div>
            )}

            {error && <div className="error-banner">{error}</div>}

            {/* Tabs */}
            <div className="subject-tabs">
                <button
                    className={`tab-btn ${activeTab === 'lessons' ? 'active' : ''}`}
                    onClick={() => setActiveTab('lessons')}
                >
                    📚 Bài giảng
                    <span className="tab-count">{lessons.length}</span>
                </button>
                <button
                    className={`tab-btn ${activeTab === 'videos' ? 'active' : ''}`}
                    onClick={() => setActiveTab('videos')}
                >
                    🎬 Video
                </button>
                <button
                    className={`tab-btn ${activeTab === 'syllabus' ? 'active' : ''}`}
                    onClick={() => setActiveTab('syllabus')}
                >
                    📋 Đề cương
                </button>
            </div>

            {/* Tab: Lessons */}
            {activeTab === 'lessons' && (
                <>
                    <div className="tab-header">
                        <button className="primary-btn" onClick={handleOpenCreateModal}>
                            + Tạo bài giảng
                        </button>
                    </div>
                    {lessons.length === 0 ? (
                        <div className="empty-state">
                            <span className="empty-icon">📝</span>
                            <h3>Chưa có bài giảng</h3>
                            <p>Tạo bài giảng đầu tiên cho môn học này</p>
                            <button className="primary-btn" onClick={handleOpenCreateModal}>
                                Tạo bài giảng
                            </button>
                        </div>
                    ) : (
                        <div className="lessons-list">
                            {lessons.map((lesson) => (
                                <div key={lesson.id} className="lesson-card">
                                    <Link to={`/lessons/${lesson.id}`} className="lesson-link">
                                        <div className="lesson-info">
                                            <h3>{lesson.title}</h3>
                                            <div className="lesson-meta">
                                                {getStatusBadge(lesson.status)}
                                                <span className="created-date">
                                                    {new Date(lesson.createdAt).toLocaleDateString('vi-VN')}
                                                </span>
                                            </div>
                                        </div>
                                    </Link>
                                    <div className="lesson-actions">
                                        <button
                                            className="edit-lesson-btn"
                                            onClick={(e) => { e.preventDefault(); openEditLessonModal(lesson); }}
                                            title="Đổi tên bài giảng"
                                        >
                                            ✏️
                                        </button>
                                        <button
                                            className="delete-btn"
                                            onClick={(e) => { e.preventDefault(); openDeleteModal(lesson); }}
                                            title="Xóa bài giảng"
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Tab: Videos */}
            {activeTab === 'videos' && (
                <VideoListPanel subjectId={id!} lessons={lessons} />
            )}

            {/* Tab: Syllabus */}
            {activeTab === 'syllabus' && (
                <SyllabusPanel subjectId={id!} />
            )}

            {/* Create Lesson Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Tạo bài giảng mới</h2>
                        
                        {syllabusForDropdown && syllabusForDropdown.lessons.filter(l => !l.lessonId).length > 0 && (
                            <div className="form-group" style={{ marginBottom: '1rem' }}>
                                <label>Chọn bài giảng từ Đề cương (Tùy chọn)</label>
                                <select 
                                    value={selectedSyllabusLessonId}
                                    onChange={(e) => {
                                        setSelectedSyllabusLessonId(e.target.value);
                                        if (e.target.value) {
                                            const sl = syllabusForDropdown.lessons.find(l => l.id === e.target.value);
                                            if (sl) setNewTitle(sl.title);
                                        } else {
                                            setNewTitle('');
                                        }
                                    }}
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px', background: 'rgba(15, 23, 42, 0.6)', color: '#f1f5f9', border: '1px solid rgba(59, 130, 246, 0.2)', fontSize: '14px' }}
                                >
                                    <option value="" style={{ background: '#1e293b', color: '#f1f5f9' }}>-- Tạo bài giảng thủ công --</option>
                                    {syllabusForDropdown.lessons.filter(l => !l.lessonId).map(sl => (
                                        <option key={sl.id} value={sl.id} style={{ background: '#1e293b', color: '#f1f5f9' }}>Bài {sl.sortOrder + 1}: {sl.title}</option>
                                    ))}
                                </select>
                                <small style={{ color: '#94a3b8', marginTop: '4px', display: 'block' }}>
                                    Nếu chọn, bài giảng sẽ tự động lấy nội dung từ đề cương.
                                </small>
                            </div>
                        )}

                        <div className="form-group">
                            <label>Tên bài giảng</label>
                            <input
                                type="text"
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                placeholder="VD: Chương 1: Giới thiệu chung"
                                autoFocus
                            />
                        </div>
                        <div className="modal-actions">
                            <button className="secondary-btn" onClick={() => setShowModal(false)}>
                                Hủy
                            </button>
                            <button className="primary-btn" onClick={handleCreateLesson} disabled={!newTitle.trim()}>
                                Tạo & Bắt đầu sửa
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Subject Modal */}
            {showEditModal && (
                <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
                    <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
                        <h2>Chỉnh sửa môn học</h2>

                        <div className="form-group">
                            <label>Tên môn học *</label>
                            <input
                                type="text"
                                value={editForm.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <label>Mô tả ngắn</label>
                            <textarea
                                value={editForm.description}
                                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                rows={2}
                            />
                        </div>

                        <div className="form-divider">
                            <span>Thông tin cho AI</span>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Loại tổ chức</label>
                                <select
                                    value={editForm.institutionType}
                                    onChange={(e) => setEditForm({ ...editForm, institutionType: e.target.value })}
                                >
                                    {INSTITUTION_TYPES.map((type) => (
                                        <option key={type} value={type}>{type}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label>Ngành học</label>
                                <input
                                    type="text"
                                    value={editForm.majorName}
                                    onChange={(e) => setEditForm({ ...editForm, majorName: e.target.value })}
                                    placeholder="VD: Công nghệ thông tin"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>🌐 Ngôn ngữ đầu ra</label>
                            <select
                                value={editForm.language || 'vi'}
                                onChange={(e) => setEditForm({ ...editForm, language: e.target.value })}
                            >
                                {LANGUAGE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                            <small className="form-hint">
                                {LANGUAGE_OPTIONS.find(o => o.value === (editForm.language || 'vi'))?.desc}
                            </small>
                        </div>

                        <div className="form-group">
                            <label>Lĩnh vực chuyên môn</label>
                            <input
                                type="text"
                                value={editForm.expertiseArea}
                                onChange={(e) => setEditForm({ ...editForm, expertiseArea: e.target.value })}
                                placeholder="VD: Lập trình, AI, Data Science"
                            />
                        </div>

                        <div className="form-group">
                            <label>Tên môn học đầy đủ</label>
                            <input
                                type="text"
                                value={editForm.courseName}
                                onChange={(e) => setEditForm({ ...editForm, courseName: e.target.value })}
                                placeholder="VD: Nhập môn lập trình với Python"
                            />
                        </div>

                        <div className="form-group">
                            <label>Đối tượng học viên</label>
                            <input
                                type="text"
                                value={editForm.targetAudience}
                                onChange={(e) => setEditForm({ ...editForm, targetAudience: e.target.value })}
                                placeholder="VD: Sinh viên đại học năm 1-2"
                            />
                        </div>

                        <div className="form-group">
                            <label>Yêu cầu bổ sung</label>
                            <textarea
                                value={editForm.additionalContext}
                                onChange={(e) => setEditForm({ ...editForm, additionalContext: e.target.value })}
                                placeholder="VD: Nội dung cần chi tiết, có nhiều ví dụ..."
                                rows={3}
                            />
                        </div>

                        <div className="modal-actions">
                            <button className="secondary-btn" onClick={() => setShowEditModal(false)}>
                                Hủy
                            </button>
                            <button className="primary-btn" onClick={handleUpdateSubject} disabled={!editForm.name.trim()}>
                                Lưu thay đổi
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Lesson Modal */}
            {showEditLessonModal && (
                <div className="modal-overlay" onClick={() => setShowEditLessonModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>✏️ Đổi tên bài giảng</h2>
                        <div className="form-group">
                            <label>Tên bài giảng</label>
                            <input
                                type="text"
                                value={editLessonTitle}
                                onChange={(e) => setEditLessonTitle(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveEditLesson()}
                                autoFocus
                            />
                        </div>
                        <div className="modal-actions">
                            <button className="secondary-btn" onClick={() => setShowEditLessonModal(false)}>
                                Hủy
                            </button>
                            <button
                                className="primary-btn"
                                onClick={handleSaveEditLesson}
                                disabled={!editLessonTitle.trim() || isEditingSaving}
                            >
                                {isEditingSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Lesson Confirmation Modal */}
            {showDeleteModal && (
                <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
                    <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="delete-confirm-icon">⚠️</div>
                        <h2>Xóa bài giảng?</h2>
                        <p className="delete-confirm-text">
                            Bạn có chắc muốn xóa bài giảng <strong>"{deleteLessonTitle}"</strong>?
                        </p>
                        <p className="delete-confirm-warning">
                            Tất cả dữ liệu liên quan (outline, slides, audio, câu hỏi) sẽ bị xóa vĩnh viễn.
                        </p>
                        <div className="modal-actions">
                            <button className="secondary-btn" onClick={() => setShowDeleteModal(false)}>
                                Hủy
                            </button>
                            <button
                                className="danger-btn"
                                onClick={confirmDeleteLesson}
                                disabled={isDeleting}
                            >
                                {isDeleting ? 'Đang xóa...' : '🗑️ Xóa vĩnh viễn'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

