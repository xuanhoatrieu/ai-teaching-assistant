import { useState } from 'react';
import { useLessonEditor } from '../../contexts/LessonEditorContext';
import './Steps.css';

export function Step1RawOutline() {
    const { lessonData, updateOutlineRaw } = useLessonEditor();
    const [rawOutline, setRawOutline] = useState(lessonData?.outlineRaw || '');
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleSave = async () => {
        if (!rawOutline.trim()) {
            setMessage({ type: 'error', text: 'Vui lòng nhập outline trước khi lưu' });
            return;
        }

        setIsSaving(true);
        setMessage(null);

        try {
            await updateOutlineRaw(rawOutline);
            setMessage({ type: 'success', text: '✓ Đã lưu outline thành công!' });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Không thể lưu outline' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="step-content">
            <div className="step-header">
                <h2>📝 Bước 1: Nhập Outline Thô</h2>
                <button
                    className="btn-primary"
                    onClick={handleSave}
                    disabled={isSaving}
                >
                    {isSaving ? '⏳ Đang lưu...' : '💾 Lưu Outline'}
                </button>
            </div>

            <p className="step-description">
                Nhập hoặc paste dàn ý thô cho bài giảng. Đây là danh sách các mục chính bạn muốn đề cập trong bài học.
            </p>

            {message && (
                <div className={`${message.type}-message`}>
                    {message.text}
                </div>
            )}

            <textarea
                className="content-textarea"
                value={rawOutline}
                onChange={(e) => setRawOutline(e.target.value)}
                placeholder={`Ví dụ:

# Bài 01: Làm quen với lập trình

1. Lập trình là gì?
2. Máy tính làm việc như thế nào?
3. Ngôn ngữ lập trình là gì?
4. Giới thiệu Python
5. Cài đặt môi trường lập trình
6. Chương trình đầu tiên: Hello World
7. Biến và kiểu dữ liệu cơ bản
8. Input và Output
9. Câu hỏi ôn tập`}
                rows={20}
            />

            <div className="content-stats">
                <span>{rawOutline.length} ký tự</span>
                <span>•</span>
                <span>{rawOutline.split('\n').filter(l => l.trim()).length} dòng</span>
            </div>
        </div>
    );
}
