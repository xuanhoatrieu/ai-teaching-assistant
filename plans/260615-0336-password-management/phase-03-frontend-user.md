# Phase 03: Frontend User Flow
Status: ⬜ Pending
Dependencies: Phase 02

## Objective
Implement user password changes in User Settings, Forgot Password page, and Reset Password page in the frontend.

## Implementation Steps
1. [ ] Update [UserSettings.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/pages/UserSettings.tsx) to add a Change Password form section:
   - Fields: currentPassword, newPassword, confirmPassword.
   - Send PATCH request to `/auth/change-password`.
2. [ ] Create [ForgotPassword.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/pages/ForgotPassword.tsx):
   - User inputs email.
   - Send POST request to `/auth/forgot-password`.
3. [ ] Create [ResetPassword.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/pages/ResetPassword.tsx):
   - Form for newPassword and confirmPassword.
   - Get token from query parameter.
   - Send POST request to `/auth/reset-password`.
4. [ ] Modify [Login.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/pages/Login.tsx) (or relevant file) to add a "Forgot Password" link.
5. [ ] Register routes in `frontend/src/App.tsx` for `/forgot-password` and `/reset-password`.

## Files to Create/Modify
- [UserSettings.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/pages/UserSettings.tsx) [MODIFY]
- [ForgotPassword.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/pages/ForgotPassword.tsx) [NEW]
- [ResetPassword.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/pages/ResetPassword.tsx) [NEW]
- [App.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/App.tsx) [MODIFY]

## Test Criteria
- [ ] Logged-in user can successfully change password in Cài đặt.
- [ ] User clicks "Quên mật khẩu" on login page, enters email, and receives prompt to check email.
- [ ] Navigating to `/reset-password?token=XXX` allows changing password.
