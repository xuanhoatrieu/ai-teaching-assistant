import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { subjectsApi, type Subject, type CreateSubjectData } from '../lib/subjects-api';
import './Subjects.css';

const INSTITUTION_TYPES = ['Đại học', 'Cao đẳng', 'THPT', 'Doanh nghiệp', 'Khác'];

export function SubjectsPage() {
    const [subjects, setSubjects] = useState<Subject[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);

    // Form state
    const [formData, setFormData] = useState<CreateSubjectData>({
        name: '',
        description: '',
        institutionType: 'Đại học',
        expertiseArea: '',
        courseName: '',
        targetAudience: '',
        majorName: '',
        additionalContext: '',
    });

    useEffect(() => {
        fetchSubjects();
    }, []);

    const fetchSubjects = async () => {
        try {
            const response = await subjectsApi.getAll();
            setSubjects(response.data);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to load subjects');
        } finally {
            setIsLoading(false);
        }
    };

    const resetForm = () => {
        setFormData({
            name: '',
            description: '',
            institutionType: 'Đại học',
            expertiseArea: '',
            courseName: '',
            targetAudience: '',
            majorName: '',
            additionalContext: '',
        });
    };

    const handleCreate = async () => {
        if (!formData.name.trim()) return;

        try {
            await subjectsApi.create(formData);
            setShowModal(false);
            resetForm();
            fetchSubjects();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to create subject');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this subject and all its lessons?')) return;

        try {
            await subjectsApi.delete(id);
            fetchSubjects();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to delete subject');
        }
    };

    if (isLoading) {
        return <div className="loading-state">Loading subjects...</div>;
    }

    return (
        <div className="subjects-page">
            <div className="page-header">
                <div>
                    <h1>My Subjects</h1>
                    <p>Organize your teaching materials by subject</p>
                </div>
                <button className="primary-btn" onClick={() => setShowModal(true)}>
                    + New Subject
                </button>
            </div>

            {error && <div className="error-banner">{error}</div>}

            {subjects.length === 0 ? (
                <div className="empty-state">
                    <span className="empty-icon">📚</span>
                    <h3>No subjects yet</h3>
                    <p>Create your first subject to get started</p>
                    <button className="primary-btn" onClick={() => setShowModal(true)}>
                        Create Subject
                    </button>
                </div>
            ) : (
                <div className="subjects-grid">
                    {subjects.map((subject) => (
                        <Link key={subject.id} to={`/subjects/${subject.id}`} className="subject-card">
                            <div className="subject-icon">📖</div>
                            <div className="subject-info">
                                <h3>{subject.name}</h3>
                                {subject.description && <p>{subject.description}</p>}
                                <span className="lesson-count">
                                    {subject._count?.lessons || 0} lessons
                                </span>
                            </div>
                            <button
                                className="delete-btn"
                                onClick={(e) => {
                                    e.preventDefault();
                                    handleDelete(subject.id);
                                }}
                            >
                                🗑️
                            </button>
                        </Link>
                    ))}
                </div>
            )}

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
                        <h2>Tạo môn học mới</h2>

                        <div className="form-group">
                            <label>Tên môn học *</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="VD: Lập trình cơ bản, Toán cao cấp"
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <label>Mô tả ngắn</label>
                            <textarea
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Mô tả về môn học..."
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
                                    value={formData.institutionType}
                                    onChange={(e) => setFormData({ ...formData, institutionType: e.target.value })}
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
                                    value={formData.majorName}
                                    onChange={(e) => setFormData({ ...formData, majorName: e.target.value })}
                                    placeholder="VD: Công nghệ thông tin"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Lĩnh vực chuyên môn</label>
                            <input
                                type="text"
                                value={formData.expertiseArea}
                                onChange={(e) => setFormData({ ...formData, expertiseArea: e.target.value })}
                                placeholder="VD: Lập trình, Trí tuệ nhân tạo, Khoa học dữ liệu"
                            />
                        </div>

                        <div className="form-group">
                            <label>Tên môn học đầy đủ</label>
                            <input
                                type="text"
                                value={formData.courseName}
                                onChange={(e) => setFormData({ ...formData, courseName: e.target.value })}
                                placeholder="VD: Nhập môn lập trình với Python"
                            />
                        </div>

                        <div className="form-group">
                            <label>Đối tượng học viên</label>
                            <input
                                type="text"
                                value={formData.targetAudience}
                                onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })}
                                placeholder="VD: Sinh viên đại học năm 1-2"
                            />
                        </div>

                        <div className="form-group">
                            <label>Yêu cầu bổ sung (tùy chọn)</label>
                            <textarea
                                value={formData.additionalContext}
                                onChange={(e) => setFormData({ ...formData, additionalContext: e.target.value })}
                                placeholder="VD: Nội dung cần đầy đủ, chi tiết, phổ quát và có nhiều ví dụ thực tiễn..."
                                rows={3}
                            />
                        </div>

                        <div className="modal-actions">
                            <button className="secondary-btn" onClick={() => { setShowModal(false); resetForm(); }}>
                                Hủy
                            </button>
                            <button className="primary-btn" onClick={handleCreate} disabled={!formData.name.trim()}>
                                Tạo môn học
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

