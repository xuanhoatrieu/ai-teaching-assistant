# Phase 02: Backend API Implementation
Status: ⬜ Pending
Dependencies: Phase 01

## Objective
Implement backend APIs for user change password, forgot password (request reset), reset password (submit reset), admin reset password, and SMTP configurations.

## Implementation Steps
1. [ ] Install `nodemailer` and `@types/nodemailer` dependency in `backend/`:
   ```bash
   npm install nodemailer
   npm install -D @types/nodemailer
   ```
2. [ ] Update [system-config.service.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/settings/system-config.service.ts) to support retrieving dynamic SMTP configurations from the `system_configs` table (`smtp.enabled`, `smtp.host`, `smtp.port`, `smtp.user`, `smtp.pass`, `smtp.from`).
3. [ ] Update [system-config.controller.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/settings/system-config.controller.ts) to add Admin-only endpoints:
   - `GET /admin/config/smtp` (Returns SMTP configs with password masked)
   - `PUT /admin/config/smtp` (Updates SMTP configs in database)
   - `GET /admin/config/smtp/test` (Attempts to send a test email to the logged-in admin user to verify configuration)
4. [ ] Create [email.service.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/common/email.service.ts) using Nodemailer. It must load the dynamic SMTP configuration at runtime from `SystemConfigService`.
5. [ ] Implement DTOs in `backend/src/auth/dto/`:
   - `ChangePasswordDto` (currentPassword, newPassword)
   - `ForgotPasswordDto` (email)
   - `ResetPasswordDto` (token, newPassword)
6. [ ] Implement logic in [auth.service.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/auth/auth.service.ts):
   - `changePassword()`
   - `forgotPassword()` (generates token, saves to DB, sends reset email using nodemailer)
   - `resetPassword()` (validates token, updates password, clears token)
7. [ ] Implement endpoints in [auth.controller.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/auth/auth.controller.ts):
   - `PATCH /auth/change-password` (JwtAuthGuard)
   - `POST /auth/forgot-password` (Public)
   - `POST /auth/reset-password` (Public)
8. [ ] Implement admin endpoint in [users.controller.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/users/users.controller.ts):
   - `PATCH /admin/users/:id/reset-password` (JwtAuthGuard, RolesGuard with ADMIN)

## Files to Create/Modify
- [email.service.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/common/email.service.ts) [NEW]
- [system-config.service.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/settings/system-config.service.ts) [MODIFY]
- [system-config.controller.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/settings/system-config.controller.ts) [MODIFY]
- [auth.service.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/auth/auth.service.ts) [MODIFY]
- [auth.controller.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/auth/auth.controller.ts) [MODIFY]
- [users.controller.ts](file:///home/trieuhoa/ai-teaching-assistant/backend/src/users/users.controller.ts) [MODIFY]
- `backend/src/auth/dto/` [NEW DTO files]

## Test Criteria
- [ ] Swagger / Postman testing: Change password succeeds when current password matches.
- [ ] SMTP endpoints function correctly, masking the password and updating system configs.
- [ ] SMTP connection test successfully sends an email to the admin.
- [ ] Forgot password API updates user in DB with a reset token and expires timestamp.
- [ ] Reset password API changes password hash and removes token when called with correct token before expiry.
- [ ] Admin API changes any user's password correctly.
