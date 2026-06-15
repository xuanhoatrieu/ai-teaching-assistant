# Phase 04: Frontend Admin Panel UI
Status: ⬜ Pending
Dependencies: Phase 03

## Objective
Implement UI in the Admin Dashboard to allow administrators to directly reset any user's password, and configure dynamic SMTP server settings.

## Implementation Steps
1. [ ] Update [Settings.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/pages/admin/Settings.tsx) to add an **SMTP Configuration Section**:
   - Fields: SMTP Enabled (checkbox), SMTP Host, SMTP Port, SMTP User, SMTP Password, SMTP From.
   - Buttons: "Save SMTP Settings" (calls PUT `/admin/config/smtp`), "Test Connection" (calls GET `/admin/config/smtp/test`).
2. [ ] Update [Users.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/pages/admin/Users.tsx):
   - Add a key icon or "Đặt lại MK" button in the Action column of the users list.
   - Design a Modal to input the new password for the selected user.
   - Call the backend API `PATCH /admin/users/:id/reset-password` on submit.

## Files to Create/Modify
- [Settings.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/pages/admin/Settings.tsx) [MODIFY]
- [Users.tsx](file:///home/trieuhoa/ai-teaching-assistant/frontend/src/pages/admin/Users.tsx) [MODIFY]

## Test Criteria
- [ ] Admin settings page displays SMTP configuration fields with passwords masked if set.
- [ ] SMTP settings can be saved and connection test can be triggered, displaying proper success/error messages.
- [ ] Admin user clicks "Đặt lại MK" next to another user. Modal opens, admin inputs new password, submits, and receives success notification.
