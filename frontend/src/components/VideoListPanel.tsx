import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { videoGenApi, type VideoItem } from '../lib/videoGenApi';
import type { Lesson } from '../lib/subjects-api';
import './VideoListPanel.css';

interface Props {
  subjectId: string;
  lessons: Lesson[];
}

export function VideoListPanel({ subjectId, lessons }: Props) {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newInputType, setNewInputType] = useState<'lesson' | 'manual'>('manual');
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchVideos();
  }, [subjectId]);

  const fetchVideos = async () => {
    try {
      setIsLoading(true);
      const res = await videoGenApi.list(subjectId);
      setVideos(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Không thể tải danh sách video');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setIsCreating(true);
    try {
      const res = await videoGenApi.create(subjectId, {
        title: newTitle.trim(),
        inputType: newInputType,
        lessonId: newInputType === 'lesson' ? selectedLessonId : undefined,
      });
      setShowCreateModal(false);
      setNewTitle('');
      navigate(`/subjects/${subjectId}/video/${res.data.id}`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Không thể tạo video');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (videoId: string) => {
    if (!confirm('Bạn có chắc muốn xóa video này?')) return;
    try {
      await videoGenApi.delete(subjectId, videoId);
      fetchVideos();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Không thể xóa video');
    }
  };

  const getStatusInfo = (status: string) => {
    const map: Record<string, { label: string; class: string; icon: string }> = {
      draft:     { label: 'Nháp',       class: 'draft',      icon: '📝' },
      pending:   { label: 'Đang chờ',   class: 'pending',    icon: '⏳' },
      script:    { label: 'Tạo kịch bản', class: 'processing', icon: '📝' },
      rendering: { label: 'Đang render', class: 'processing', icon: '🎬' },
      composing: { label: 'Ghép video',  class: 'processing', icon: '🔧' },
      uploading: { label: 'Đang upload', class: 'processing', icon: '📤' },
      done:      { label: 'Hoàn thành',  class: 'completed',  icon: '✅' },
      error:     { label: 'Lỗi',        class: 'failed',     icon: '❌' },
    };
    return map[status] || { label: status, class: 'draft', icon: '❓' };
  };

  const getWizardStepLabel = (step: number) => {
    const steps = ['', 'Đầu vào', 'Kịch bản', 'Cấu hình', 'Render', 'Hoàn thành'];
    return steps[step] || '';
  };

  if (isLoading) {
    return <div className="video-list-loading">Đang tải...</div>;
  }

  return (
    <div className="video-list-panel">
      <div className="tab-header">
        <button className="primary-btn" onClick={() => setShowCreateModal(true)}>
          + Tạo video mới
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {videos.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🎬</span>
          <h3>Chưa có video nào</h3>
          <p>Tạo video bài giảng đầu tiên cho môn học này</p>
          <button className="primary-btn" onClick={() => setShowCreateModal(true)}>
            Tạo video
          </button>
        </div>
      ) : (
        <div className="video-list">
          {videos.map((video) => {
            const statusInfo = getStatusInfo(video.status);
            return (
              <div
                key={video.id}
                className="video-card"
                onClick={() => navigate(`/subjects/${subjectId}/video/${video.id}`)}
              >
                <div className="video-card-thumbnail">
                  {video.thumbnailUrl ? (
                    <img src={video.thumbnailUrl} alt={video.title} />
                  ) : (
                    <div className="video-card-placeholder">
                      <span>{statusInfo.icon}</span>
                    </div>
                  )}
                  {video.duration && (
                    <span className="video-duration">
                      {Math.floor(video.duration / 60)}:{String(Math.floor(video.duration % 60)).padStart(2, '0')}
                    </span>
                  )}
                </div>

                <div className="video-card-info">
                  <h3 className="video-card-title">{video.title}</h3>
                  <div className="video-card-meta">
                    <span className={`status-badge ${statusInfo.class}`}>
                      {statusInfo.icon} {statusInfo.label}
                    </span>
                    {video.status !== 'done' && video.status !== 'draft' && video.status !== 'error' && (
                      <span className="video-progress-mini">
                        {video.progress}% — {getWizardStepLabel(video.wizardStep)}
                      </span>
                    )}
                    <span className="created-date">
                      {new Date(video.createdAt).toLocaleDateString('vi-VN')}
                    </span>
                  </div>
                  {video.lesson && (
                    <span className="video-lesson-tag">📚 {video.lesson.title}</span>
                  )}
                </div>

                <div className="video-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="delete-btn"
                    onClick={() => handleDelete(video.id)}
                    title="Xóa video"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Video Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>🎬 Tạo video mới</h2>

            <div className="form-group">
              <label>Tên video</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="VD: Bài giảng Giới thiệu Lập trình"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>Nguồn nội dung</label>
              <div className="input-type-options">
                <label className={`input-type-card ${newInputType === 'manual' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="inputType"
                    value="manual"
                    checked={newInputType === 'manual'}
                    onChange={() => setNewInputType('manual')}
                  />
                  <span className="input-type-icon">✍️</span>
                  <span className="input-type-label">Nhập thủ công</span>
                  <span className="input-type-desc">Nhập nội dung hoặc yêu cầu</span>
                </label>
                <label className={`input-type-card ${newInputType === 'lesson' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="inputType"
                    value="lesson"
                    checked={newInputType === 'lesson'}
                    onChange={() => setNewInputType('lesson')}
                  />
                  <span className="input-type-icon">📚</span>
                  <span className="input-type-label">Từ bài giảng</span>
                  <span className="input-type-desc">Lấy nội dung bài giảng có sẵn</span>
                </label>
              </div>
            </div>

            {newInputType === 'lesson' && (
              <div className="form-group">
                <label>Chọn bài giảng</label>
                <select
                  value={selectedLessonId}
                  onChange={(e) => setSelectedLessonId(e.target.value)}
                >
                  <option value="">-- Chọn bài giảng --</option>
                  {lessons.map((l) => (
                    <option key={l.id} value={l.id}>{l.title}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setShowCreateModal(false)}>
                Hủy
              </button>
              <button
                className="primary-btn"
                onClick={handleCreate}
                disabled={isCreating || !newTitle.trim() || (newInputType === 'lesson' && !selectedLessonId)}
              >
                {isCreating ? 'Đang tạo...' : 'Tạo & Mở Studio'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
