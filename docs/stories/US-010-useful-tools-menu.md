# US-010 Useful Tools Menu

## Status

planned

## Lane

normal

## Risk Classification

| Risk flag | Applies? | Reason |
| --- | --- | --- |
| Auth | No | |
| Authorization | **Yes** | Admin-only CRUD vs public read |
| Data model | **Yes** | New `UsefulLink` table, Prisma migration |
| Audit/security | No | |
| External systems | No | Just stores URLs, no external calls |
| Public contracts | **Yes** | New API endpoints for CRUD and listing |
| Cross-platform | No | |
| Existing behavior | No | Purely additive — new menu, no existing changes |
| Weak proof | Yes | No existing tests |
| Multi-domain | No | Single domain (admin config + user UI) |

**Flags: 3 → normal with stronger validation** (Authorization is a soft gate here: simple admin role check, same pattern as existing admin endpoints)

## Product Contract

Admin users can manage a list of useful external tool links. All authenticated users can view these links in the navigation bar for quick access.

## Relevant Product Docs

- `docs/BRIEF.md` — Original product spec
- `docs/ARCHITECTURE.md` — System architecture

## Acceptance Criteria

- Admin can create a new useful link (title, URL, icon, description, sort order)
- Admin can edit an existing useful link
- Admin can delete a useful link
- Admin can toggle active/inactive status for a link
- Admin UI section appears in the Settings page
- Users see a "🧰 Công cụ" dropdown in the header navbar
- Dropdown shows only active links, sorted by sortOrder
- Clicking a link opens it in a new browser tab
- Empty state: dropdown hidden when no active links exist

## Design Notes

- Tables: `useful_links` (new)
- API: `GET /useful-links` (public, auth required), `POST/PUT/DELETE /admin/useful-links` (admin only)
- Domain rules: Only active links shown to users
- UI surfaces: UserLayout header (dropdown), Admin Settings page (CRUD table)

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | UsefulLinksService CRUD operations |
| Integration | Admin creates link → user sees it in dropdown |
| E2E | Full flow: admin adds link → regular user sees and clicks it |
| Platform | |
| Release | |

## Harness Delta

- Reusable pattern: admin-managed config displayed in user UI

## Evidence

Pending implementation.
