import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    subjectsApi,
    type Subject,
    type CreateSubjectData,
    INSTITUTION_TYPES,
    LANGUAGE_OPTIONS,
    QUICK_TAG_OPTIONS,
} from '../lib/subjects-api';
import './Subjects.css';

export function SubjectsPage() {
    const [subjects, setSubjects] = useState<Subject[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);

    // Form state
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        institutionType: 'Đại học',
        majorArea: '',
        targetAudience: '',
        language: 'vi',
    });

    const [selectedTags, setSelectedTags] = useState<string[]>(
        QUICK_TAG_OPTIONS.filter((t) => t.defaultActive).map((t) => t.label)
    );
    const [customRequirements, setCustomRequirements] = useState('');

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

    const toggleTag = (tagLabel: string) => {
        setSelectedTags((prev) =>
            prev.includes(tagLabel)
                ? prev.filter((t) => t !== tagLabel)
                : [...prev, tagLabel]
        );
    };

    const resetForm = () => {
        setFormData({
            name: '',
            description: '',
            institutionType: 'Đại học',
            majorArea: '',
            targetAudience: '',
            language: 'vi',
        });
        setSelectedTags(QUICK_TAG_OPTIONS.filter((t) => t.defaultActive).map((t) => t.label));
        setCustomRequirements('');
    };

    const handleCreate = async () => {
        if (!formData.name.trim()) return;

        const contextParts: string[] = [];
        if (selectedTags.length > 0) {
            contextParts.push(selectedTags.join(', '));
        }
        if (customRequirements.trim()) {
            contextParts.push(customRequirements.trim());
        }
        const additionalContext = contextParts.join('. ');

        const payload: CreateSubjectData = {
            name: formData.name.trim(),
            courseName: formData.name.trim(),
            description: formData.description.trim() || undefined,
            institutionType: formData.institutionType,
            majorName: formData.majorArea.trim() || undefined,
            expertiseArea: formData.majorArea.trim() || undefined,
            targetAudience: formData.targetAudience.trim() || undefined,
            language: formData.language || 'vi',
            additionalContext: additionalContext || undefined,
        };

        try {
            await subjectsApi.create(payload);
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
                                placeholder="VD: Lập trình Python, Toán cao cấp, Kinh tế vi mô..."
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <label>Mô tả ngắn</label>
                            <textarea
                                className="desc-textarea"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Mô tả tóm tắt về môn học..."
                                rows={15}
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
                                <label>Đối tượng học viên</label>
                                <input
                                    type="text"
                                    value={formData.targetAudience}
                                    onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })}
                                    placeholder="VD: Sinh viên năm 1-2, Người đi làm..."
                                />
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Ngành học / Lĩnh vực</label>
                                <input
                                    type="text"
                                    value={formData.majorArea}
                                    onChange={(e) => setFormData({ ...formData, majorArea: e.target.value })}
                                    placeholder="VD: Công nghệ thông tin, Trí tuệ nhân tạo..."
                                />
                            </div>

                            <div className="form-group">
                                <label>🌐 Ngôn ngữ đầu ra</label>
                                <select
                                    value={formData.language || 'vi'}
                                    onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                                >
                                    {LANGUAGE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                                <small className="form-hint">
                                    {LANGUAGE_OPTIONS.find((o) => o.value === (formData.language || 'vi'))?.desc}
                                </small>
                            </div>
                        </div>

                        <div className="form-divider">
                            <span>Yêu cầu biên soạn AI</span>
                        </div>

                        <div className="form-group">
                            <label className="section-sublabel">Tiêu chí chất lượng mặc định (nhấp để bật/tắt):</label>
                            <div className="quick-tags-container">
                                {QUICK_TAG_OPTIONS.map((tag) => {
                                    const isSelected = selectedTags.includes(tag.label);
                                    return (
                                        <button
                                            key={tag.id}
                                            type="button"
                                            className={`quick-tag-chip ${isSelected ? 'active' : ''}`}
                                            onClick={() => toggleTag(tag.label)}
                                        >
                                            <span className="tag-icon">{isSelected ? '✓' : '+'}</span>
                                            {tag.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Yêu cầu bổ sung khác (tùy chọn)</label>
                            <textarea
                                className="req-textarea"
                                value={customRequirements}
                                onChange={(e) => setCustomRequirements(e.target.value)}
                                placeholder="Gõ thêm yêu cầu đặc thù khác nếu có (VD: Tập trung vào giải thuật, không dùng thư viện ngoài...)"
                                rows={5}
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

