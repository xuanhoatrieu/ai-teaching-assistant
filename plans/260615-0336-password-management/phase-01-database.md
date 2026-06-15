# Phase 01: Database Migration
Status: ⬜ Pending
Dependencies: None

## Objective
Add fields for password reset tokens and token expiration to the `User` database model and migrate the database.

## Implementation Steps
1. [ ] Modify [schema.prisma](file:///home/trieuhoa/ai-teaching-assistant/backend/prisma/schema.prisma) to add:
   - `resetPasswordToken String? @map("reset_password_token")`
   - `resetPasswordExpires DateTime? @map("reset_password_expires")`
2. [ ] Run Prisma migration command:
   ```bash
   npx prisma migrate dev --name add_reset_password_fields
   ```
3. [ ] Verify that database contains the new columns.

## Files to Create/Modify
- [schema.prisma](file:///home/trieuhoa/ai-teaching-assistant/backend/prisma/schema.prisma) - Add fields to User model.

## Test Criteria
- [ ] Database columns `reset_password_token` and `reset_password_expires` exist in the `users` table.
- [ ] Backend runs and Prisma Client regenerates without errors.
