# Phase 05: SMTP Email Integration & E2E Verification
Status: ⬜ Pending
Dependencies: Phase 04

## Objective
Configure SMTP environment variables, verify email sending integration, and perform end-to-end verification of all password flows.

## Implementation Steps
1. [ ] Add SMTP credentials to `.env` (development) and `.env.example`.
2. [ ] Test sending a password reset email using a mock/test SMTP server (such as Mailtrap, or a Gmail account with an App Password).
3. [ ] Verify secure token expiration:
   - Manually edit DB token expiration to the past.
   - Try resetting password; ensure it returns token expired/invalid.
4. [ ] Perform a full E2E manual regression:
   - User profile password change
   - Admin user password reset
   - Self-service email password reset link flow

## Files to Create/Modify
- [.env.example](file:///home/trieuhoa/ai-teaching-assistant/.env.example) [MODIFY]
- `.env` [MODIFY]

## Test Criteria
- [ ] Reset password email is successfully delivered.
- [ ] Email link redirects user to the reset page with correct token.
- [ ] Expired tokens are rejected by the server.
- [ ] Production build (`npm run build`) runs successfully for both backend and frontend.
