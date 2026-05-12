import React, { useState, useEffect } from 'react';
import { videoGenApi, type VideoHistory as VideoHistoryType } from '../lib/videoGenApi';

interface VideoHistoryProps {
  lessonId: string;
  onPlay: (videoUrl: string) => void;
}

export const VideoHistory: React.FC<VideoHistoryProps> = ({ lessonId, onPlay }) => {
  const [history, setHistory] = useState<VideoHistoryType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const { data } = await videoGenApi.getHistory();
      setHistory(data.filter((v) => v.lessonId === lessonId));
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (videoId: string) => {
    if (!confirm('Xóa video này?')) return;
    try {
      await videoGenApi.deleteVideo(lessonId, videoId);
      setHistory((prev) => prev.filter((v) => v.id !== videoId));
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const formatDuration = (sec?: number) => {
    if (!sec) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) return <div className="history-skeleton">Đang tải...</div>;
  if (history.length === 0) return null;

  return (
    <div className="video-history">
      <h3 className="panel-title">📋 Lịch sử Video</h3>
      <table className="history-table">
        <thead>
          <tr>
            <th>Ngày tạo</th>
            <th>Chất lượng</th>
            <th>Ngôn ngữ</th>
            <th>Thời lượng</th>
            <th>Trạng thái</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {history.map((video) => (
            <tr key={video.id}>
              <td>{formatDate(video.createdAt)}</td>
              <td>{video.resolution}</td>
              <td>{video.narrationLang === 'vi' ? 'Tiếng Việt' : 'English'}</td>
              <td>{formatDuration(video.duration)}</td>
              <td>
                <span className={`status-badge status-${video.status}`}>
                  {video.status === 'done' ? '✅ Xong' : video.status}
                </span>
              </td>
              <td className="history-actions">
                {video.videoUrl && (
                  <button
                    className="btn-icon"
                    onClick={() => onPlay(video.videoUrl!)}
                    title="Phát"
                  >
                    ▶️
                  </button>
                )}
                <button
                  className="btn-icon btn-danger"
                  onClick={() => handleDelete(video.id)}
                  title="Xóa"
                >
                  🗑️
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
