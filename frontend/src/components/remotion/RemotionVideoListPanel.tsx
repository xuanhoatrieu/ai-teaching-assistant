import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { remotionApi, type RemotionVideoItem, type SuggestedTopic } from '../../lib/remotionApi';
import { api } from '../../lib/api';
import type { Lesson } from '../../lib/subjects-api';
import './RemotionVideoListPanel.css';

interface Props {
  subjectId: string;
  lessons: Lesson[];
}

export function RemotionVideoListPanel({ subjectId, lessons }: Props) {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<RemotionVideoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Create Modal State
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'slide' | 'ai_topic' | 'manual'>('slide');

  // Tab 1: Slide
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [lessonSlides, setLessonSlides] = useState<any[]>([]);
  const [loadingSlides, setLoadingSlides] = useState(false);
  const [selectedSlideIdx, setSelectedSlideIdx] = useState<number | null>(null);

  // Tab 2: AI Topics
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [suggestedTopics, setSuggestedTopics] = useState<SuggestedTopic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<SuggestedTopic | null>(null);

  // Tab 3: Manual
  const [manualTitle, setManualTitle] = useState('');
  const [manualTemplate, setManualTemplate] = useState<'explainer' | 'comparison' | 'pipeline' | 'quiz'>('explainer');
  const [manualRatio, setManualRatio] = useState<'9:16' | '16:9'>('9:16');
  const [manualDuration, setManualDuration] = useState<number>(30);
  const [manualScript, setManualScript] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchVideos();
  }, [subjectId]);

  // Set default selected lesson when lessons are loaded
  useEffect(() => {
    if (lessons.length > 0 && !selectedLessonId) {
      setSelectedLessonId(lessons[0].id);
    }
  }, [lessons]);

  // Load slides when selected lesson changes
  useEffect(() => {
    if (selectedLessonId && showModal) {
      fetchLessonSlides(selectedLessonId);
    }
  }, [selectedLessonId, showModal]);

  const fetchVideos = async () => {
    try {
      setIsLoading(true);
      const res = await remotionApi.list(subjectId);
      setVideos(res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Không thể tải danh sách video Remotion');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLessonSlides = async (lessonId: string) => {
    try {
      setLoadingSlides(true);
      const res = await api.get(`/lessons/${lessonId}/slides`);
      setLessonSlides(res.data || []);
      if (res.data && res.data.length > 0) {
        setSelectedSlideIdx(res.data[0].slideIndex);
      }
    } catch (err) {
      console.error('Failed to load slides', err);
      setLessonSlides([]);
    } finally {
      setLoadingSlides(false);
    }
  };

  const handleFetchAiTopics = async () => {
    if (!selectedLessonId) return;
    try {
      setLoadingTopics(true);
      const res = await remotionApi.suggestTopics(subjectId, selectedLessonId);
      setSuggestedTopics(res.data || []);
      if (res.data && res.data.length > 0) {
        setSelectedTopic(res.data[0]);
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Lỗi gợi ý chủ đề');
    } finally {
      setLoadingTopics(false);
    }
  };

  const handleCreateVideo = async () => {
    setIsSubmitting(true);
    try {
      if (activeTab === 'slide') {
        if (selectedSlideIdx === null) {
          alert('Vui lòng chọn một slide bài giảng');
          return;
        }
        const slide = lessonSlides.find((s) => s.slideIndex === selectedSlideIdx);
        const res = await remotionApi.create(subjectId, {
          title: slide ? `Giải thích: ${slide.title}` : 'Video từ Slide',
          lessonId: selectedLessonId,
          inputType: 'slide',
          sourceSlideIdx: selectedSlideIdx,
          templateType: 'explainer',
          aspectRatio: '9:16',
          targetDuration: 30,
        });
        setShowModal(false);
        navigate(`/subjects/${subjectId}/remotion/${res.data.id}`);
      } else if (activeTab === 'ai_topic') {
        if (!selectedTopic) {
          alert('Vui lòng chọn một chủ đề do AI đề xuất');
          return;
        }
        const res = await remotionApi.create(subjectId, {
          title: selectedTopic.title,
          lessonId: selectedLessonId,
          inputType: 'ai_topic',
          sourceSlideIdx: selectedTopic.sourceSlideIndex,
          templateType: selectedTopic.recommendedTemplate || 'explainer',
          aspectRatio: '9:16',
          targetDuration: selectedTopic.targetDurationSec || 30,
        });
        setShowModal(false);
        navigate(`/subjects/${subjectId}/remotion/${res.data.id}`);
      } else {
        // Manual
        if (!manualTitle.trim()) {
          alert('Vui lòng nhập tiêu đề video');
          return;
        }
        const res = await remotionApi.create(subjectId, {
          title: manualTitle.trim(),
          lessonId: selectedLessonId || undefined,
          inputType: 'manual',
          templateType: manualTemplate,
          aspectRatio: manualRatio,
          targetDuration: manualDuration,
          scriptContent: manualScript.trim() || undefined,
        });
        setShowModal(false);
        navigate(`/subjects/${subjectId}/remotion/${res.data.id}`);
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Lỗi khi tạo video Remotion');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (videoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Bạn có chắc muốn xóa video này?')) return;
    try {
      await remotionApi.delete(subjectId, videoId);
      setVideos(videos.filter((v) => v.id !== videoId));
    } catch (err: any) {
      alert(err.response?.data?.message || 'Không thể xóa video');
    }
  };

  const getTemplateLabel = (type: string) => {
    switch (type) {
      case 'comparison':
        return '⚔️ So sánh A/B';
      case 'pipeline':
        return '🔄 Quy trình';
      case 'quiz':
        return '❓ Đố vui';
      default:
        return '💡 Giải thích';
    }
  };

  const getPosterIcon = (type: string) => {
    switch (type) {
      case 'comparison':
        return '⚔️';
      case 'pipeline':
        return '🔄';
      case 'quiz':
        return '❓';
      default:
        return '💡';
    }
  };

  return (
    <div className="remotion-panel-container">
      {/* Header Banner */}
      <div className="remotion-panel-header">
        <div className="remotion-panel-title-area">
          <h3>🎬 Video-Remotion Học Thuật</h3>
          <p className="remotion-panel-desc">
            Tạo video ngắn giải thích khái niệm, so sánh đối chiếu và quy trình bằng React Remotion. Xem trước tức thì 60fps trên trình duyệt.
          </p>
        </div>
        <button
          className="remotion-create-btn"
          onClick={() => setShowModal(true)}
        >
          <span>✨</span> + Tạo Video-Remotion Mới
        </button>
      </div>

      {error && <div style={{ color: '#ef4444', padding: '10px' }}>{error}</div>}

      {/* Videos List */}
      {isLoading ? (
        <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px' }}>
          Đang tải danh sách video...
        </div>
      ) : videos.length === 0 ? (
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.4)',
            border: '2px dashed rgba(255, 255, 255, 0.1)',
            borderRadius: '20px',
            padding: '60px 20px',
            textAlign: 'center',
            color: '#94a3b8',
          }}
        >
          <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>🎬</div>
          <h4 style={{ color: '#f8fafc', fontSize: '1.2rem', margin: '0 0 8px 0' }}>
            Chưa có video Remotion nào trong môn học này
          </h4>
          <p style={{ margin: '0 0 24px 0', fontSize: '0.95rem' }}>
            Bấm vào nút bên dưới để tạo video 30s giải thích slide bài giảng hoặc để AI tự đề xuất chủ đề.
          </p>
          <button
            className="remotion-create-btn"
            style={{ margin: '0 auto' }}
            onClick={() => setShowModal(true)}
          >
            + Tạo Video Đầu Tiên
          </button>
        </div>
      ) : (
        <div className="remotion-video-grid">
          {videos.map((video) => (
            <div
              key={video.id}
              className="remotion-video-card"
              onClick={() => navigate(`/subjects/${subjectId}/remotion/${video.id}`)}
              style={{ cursor: 'pointer' }}
            >
              {/* Poster Preview */}
              <div
                className={`remotion-card-poster ${
                  video.aspectRatio === '9:16' ? 'vertical' : ''
                }`}
              >
                <div className="remotion-poster-icon">
                  {getPosterIcon(video.templateType)}
                </div>

                {/* Badges */}
                <div className="remotion-card-badges">
                  <span className="remotion-badge template">
                    {getTemplateLabel(video.templateType)}
                  </span>
                  <span className="remotion-badge ratio">{video.aspectRatio}</span>
                </div>

                {/* Duration */}
                <div className="remotion-card-duration">
                  {video.durationSeconds
                    ? `${Math.round(video.durationSeconds)}s`
                    : `${video.targetDuration || 30}s`}
                </div>
              </div>

              {/* Body */}
              <div className="remotion-card-body">
                <h4 className="remotion-card-title">{video.title}</h4>

                <div className="remotion-card-meta">
                  {video.lesson && <span>📖 {video.lesson.title}</span>}
                  <span>🎞️ {(video.scenesJson as any[])?.length || 0} cảnh</span>
                </div>

                {/* Status Indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    className={`remotion-badge status-${video.status}`}
                  >
                    {video.status === 'completed'
                      ? '✓ Đã xuất MP4'
                      : video.status === 'rendering'
                      ? `⏳ Đang render ${video.progress}%`
                      : '📝 Bản nháp'}
                  </span>
                </div>

                {/* Actions */}
                <div className="remotion-card-actions">
                  <button
                    className="remotion-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/subjects/${subjectId}/remotion/${video.id}`);
                    }}
                  >
                    ✏️ Biên tập
                  </button>

                  {video.videoUrl && (
                    <a
                      href={video.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="remotion-action-btn"
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: '#34d399', borderColor: '#10b981' }}
                    >
                      📥 Tải MP4
                    </a>
                  )}

                  <button
                    className="remotion-action-btn delete"
                    onClick={(e) => handleDelete(video.id, e)}
                    title="Xóa video"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE MODAL WITH 3 MODES */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '24px',
              padding: '32px',
              width: '100%',
              maxWidth: '680px',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.4rem', color: '#f8fafc' }}>
              Tạo Video-Remotion Mới
            </h3>

            {/* 3 Tabs */}
            <div className="remotion-modal-tabs">
              <button
                className={`remotion-modal-tab-btn ${activeTab === 'slide' ? 'active' : ''}`}
                onClick={() => setActiveTab('slide')}
              >
                1. 🖼️ Từ Slide Bài Giảng
              </button>
              <button
                className={`remotion-modal-tab-btn ${activeTab === 'ai_topic' ? 'active' : ''}`}
                onClick={() => setActiveTab('ai_topic')}
              >
                2. 💡 AI Gợi Ý Chủ Đề
              </button>
              <button
                className={`remotion-modal-tab-btn ${activeTab === 'manual' ? 'active' : ''}`}
                onClick={() => setActiveTab('manual')}
              >
                3. ✍️ Tự Viết Tự Do
              </button>
            </div>

            {/* Lesson Selector for Tabs 1 & 2 */}
            {(activeTab === 'slide' || activeTab === 'ai_topic') && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', color: '#cbd5e1', fontWeight: 600 }}>
                  Chọn bài giảng nguồn:
                </label>
                <select
                  value={selectedLessonId}
                  onChange={(e) => setSelectedLessonId(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#1e293b',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    color: '#f8fafc',
                    fontSize: '0.95rem',
                  }}
                >
                  {lessons.map((lesson) => (
                    <option key={lesson.id} value={lesson.id}>
                      {lesson.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* TAB 1: SLIDE CONTENT */}
            {activeTab === 'slide' && (
              <div>
                <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '12px' }}>
                  Chọn 1 slide trọng tâm để làm video ngắn 30s (tự động lấy ảnh AI và audio thuyết minh của slide đó):
                </p>

                {loadingSlides ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
                    Đang tải danh sách slide...
                  </div>
                ) : lessonSlides.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#ef4444' }}>
                    Bài học này chưa có slide nào. Vui lòng soạn slide ở Bước 3 trước.
                  </div>
                ) : (
                  <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {lessonSlides.map((slide) => (
                      <div
                        key={slide.slideIndex}
                        onClick={() => setSelectedSlideIdx(slide.slideIndex)}
                        style={{
                          background: selectedSlideIdx === slide.slideIndex ? 'rgba(99, 102, 241, 0.15)' : 'rgba(30, 41, 59, 0.6)',
                          border: selectedSlideIdx === slide.slideIndex ? '2px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '12px',
                          padding: '12px 16px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '14px',
                        }}
                      >
                        <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#818cf8', width: '32px' }}>
                          #{slide.slideIndex}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '0.95rem' }}>
                            {slide.title}
                          </div>
                          <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '420px' }}>
                            {slide.content || 'Nội dung slide'}
                          </div>
                        </div>
                        {slide.imageUrl && <span title="Có ảnh minh họa AI">🖼️</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: AI TOPICS */}
            {activeTab === 'ai_topic' && (
              <div>
                <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '12px' }}>
                  AI sẽ đọc toàn bộ bài học và đề xuất 3 đến 5 chủ đề ngắn đắt giá nhất để làm video:
                </p>

                {suggestedTopics.length === 0 ? (
                  <button
                    onClick={handleFetchAiTopics}
                    disabled={loadingTopics || !selectedLessonId}
                    style={{
                      width: '100%',
                      background: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    {loadingTopics ? 'Đang phân tích bài học bằng AI...' : '✨ Bấm để AI Gợi Ý Chủ Đề'}
                  </button>
                ) : (
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {suggestedTopics.map((topic) => (
                      <div
                        key={topic.id}
                        className={`remotion-topic-card ${selectedTopic?.id === topic.id ? 'selected' : ''}`}
                        onClick={() => setSelectedTopic(topic)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ color: '#f8fafc', fontWeight: 800, fontSize: '1rem' }}>
                            {topic.title}
                          </span>
                          <span className="remotion-badge template">
                            {getTemplateLabel(topic.recommendedTemplate)} • {topic.targetDurationSec}s
                          </span>
                        </div>
                        <div style={{ color: '#38bdf8', fontSize: '0.86rem', fontStyle: 'italic', marginBottom: '4px' }}>
                          "{topic.hookQuestion}"
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '0.82rem' }}>
                          {topic.coreConcept}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: MANUAL INPUT */}
            {activeTab === 'manual' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', color: '#cbd5e1', fontWeight: 600 }}>
                    Tiêu đề video:
                  </label>
                  <input
                    type="text"
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    placeholder="Ví dụ: Khái niệm Deadlock trong Hệ điều hành"
                    style={{
                      width: '100%',
                      background: '#1e293b',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '10px',
                      padding: '10px 14px',
                      color: '#f8fafc',
                      fontSize: '0.95rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 600 }}>
                      Template học thuật:
                    </label>
                    <select
                      value={manualTemplate}
                      onChange={(e: any) => setManualTemplate(e.target.value)}
                      style={{
                        width: '100%',
                        background: '#1e293b',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '8px',
                        padding: '8px',
                        color: '#f8fafc',
                      }}
                    >
                      <option value="explainer">💡 Giải thích</option>
                      <option value="comparison">⚔️ So sánh A/B</option>
                      <option value="pipeline">🔄 Quy trình</option>
                      <option value="quiz">❓ Đố vui</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 600 }}>
                      Định dạng khung hình:
                    </label>
                    <select
                      value={manualRatio}
                      onChange={(e: any) => setManualRatio(e.target.value)}
                      style={{
                        width: '100%',
                        background: '#1e293b',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '8px',
                        padding: '8px',
                        color: '#f8fafc',
                      }}
                    >
                      <option value="9:16">📱 9:16 (Dọc Shorts/TikTok)</option>
                      <option value="16:9">📐 16:9 (Ngang Bài giảng)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 600 }}>
                      Thời lượng mục tiêu:
                    </label>
                    <select
                      value={manualDuration}
                      onChange={(e) => setManualDuration(Number(e.target.value))}
                      style={{
                        width: '100%',
                        background: '#1e293b',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '8px',
                        padding: '8px',
                        color: '#f8fafc',
                      }}
                    >
                      <option value={30}>30 giây (Micro)</option>
                      <option value={45}>45 giây</option>
                      <option value={60}>60 giây</option>
                      <option value={90}>90 giây</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', color: '#cbd5e1', fontWeight: 600 }}>
                    Ý tưởng hoặc lời thoại tự do (Tùy chọn):
                  </label>
                  <textarea
                    rows={3}
                    value={manualScript}
                    onChange={(e) => setManualScript(e.target.value)}
                    placeholder="Nhập ghi chú hoặc phác thảo nội dung. AI sẽ dựa vào đây để sinh các phân cảnh."
                    style={{
                      width: '100%',
                      background: '#1e293b',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '10px',
                      padding: '10px 14px',
                      color: '#f8fafc',
                      fontSize: '0.9rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '28px' }}>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#cbd5e1',
                  borderRadius: '10px',
                  padding: '10px 20px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleCreateVideo}
                disabled={isSubmitting}
                style={{
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '10px 24px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 15px rgba(99, 102, 241, 0.4)',
                }}
              >
                {isSubmitting ? 'Đang khởi tạo...' : 'Tạo Video & Vào Studio ➔'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
