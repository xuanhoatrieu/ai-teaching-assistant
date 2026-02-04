import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';

// Auth pages
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';

// Admin
import { AdminLayout } from './layouts/AdminLayout';
import { AdminDashboard } from './pages/admin/Dashboard';
import { PromptsPage } from './pages/admin/Prompts';
import { TemplatesPage } from './pages/admin/Templates';
import { TTSProvidersPage } from './pages/admin/TTSProviders';
import { UsersPage } from './pages/admin/Users';
import { SettingsPage } from './pages/admin/Settings';
import { ApiKeysPage } from './pages/admin/ApiKeys';

// User (Lesson flow)
import { UserLayout } from './layouts/UserLayout';
import { SubjectsPage } from './pages/Subjects';
import { SubjectDetailPage } from './pages/SubjectDetail';
import { LessonEditorPage } from './pages/LessonEditor';
import { LessonEditorPageV2 } from './pages/LessonEditorV2';
import { LessonProgressPage } from './pages/LessonProgress';
import { LessonPreviewPage } from './pages/LessonPreview';
import { UserSettingsPage } from './pages/UserSettings';

import './index.css';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* User Routes (Protected) */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <UserLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<SubjectsPage />} />
            <Route path="subjects/:id" element={<SubjectDetailPage />} />
            <Route path="lessons/:id" element={<LessonEditorPageV2 />} />
            <Route path="lessons/:id/classic" element={<LessonEditorPage />} />
            <Route path="lessons/:id/progress" element={<LessonProgressPage />} />
            <Route path="lessons/:id/preview" element={<LessonPreviewPage />} />
            <Route path="settings" element={<UserSettingsPage />} />
          </Route>

          {/* Admin Routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="prompts" element={<PromptsPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="tts-providers" element={<TTSProvidersPage />} />
            <Route path="api-keys" element={<ApiKeysPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
