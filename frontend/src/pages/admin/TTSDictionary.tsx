import { TTSDictionaryManager } from '../../components/admin/TTSDictionaryManager';
import './AdminPage.css';

export function TTSDictionaryPage() {
    return (
        <div className="admin-page">
            <div className="page-header">
                <div>
                    <h1>📖 Từ Điển TTS</h1>
                    <p>Quản lý từ điển phát âm cho Text-to-Speech hệ thống</p>
                </div>
            </div>
            <TTSDictionaryManager />
        </div>
    );
}
