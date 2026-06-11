# US-011 Mobile UI and Responsiveness Optimization

## Status

implemented

## Lane

normal

## Risk Classification

| Risk flag | Applies? | Reason |
| --- | --- | --- |
| Auth | No | |
| Authorization | No | |
| Data model | No | |
| Audit/security | No | |
| External systems | No | |
| Public contracts | No | |
| Cross-platform | **Yes** | Specifically targets mobile/tablet responsive layout adjustments |
| Existing behavior | **Yes** | Alters existing CSS layout structures of layouts and pages |
| Weak proof | No | |
| Multi-domain | No | |

**Flags: 2 → normal with stronger validation**

## Product Contract

All user-facing and admin pages must be completely functional and visually elegant on mobile viewports (down to 320px width). Core layout elements like navigation menus, grids, modals, and tab lists must scale, wrap, or collapse appropriately to avoid horizontal overflows. Hover-only controls must be converted to touch-friendly interfaces.

## Relevant Product Docs

- `docs/HARNESS.md` — Harness core workflow
- `docs/FEATURE_INTAKE.md` — Intake and risk lane definition

## Acceptance Criteria

### User Layout & Navigation
- [x] On screens <= 768px, horizontal navigation links and user controls are hidden behind a toggleable Hamburger button.
- [x] Clicking the Hamburger button opens a responsive dropdown menu or slide-in drawer showing all navigation items, the user's email, the Admin link (if applicable), and the Logout button.
- [x] The "Công cụ" dropdown menu works properly inside the mobile layout.
- [x] Padding for the main user container is reduced to 16px on mobile viewports.

### Admin Layout & Sidebar
- [x] On screens <= 768px, the 260px fixed sidebar is hidden by default (`transform: translateX(-100%)`).
- [x] A top header with a Menu toggle button is displayed on mobile for Admin pages.
- [x] Toggling the Menu button slides the sidebar into view as an overlay drawer.
- [x] The main admin content area occupies the full width on mobile viewports.

### Subjects List & Subject Details
- [x] Subject creation modals scale down properly to screen width (92% width, reduced padding).
- [x] The subject detail tabs wrap onto new lines without overflow.
- [x] Lesson cards show their actions (Edit/Delete icons) constantly on touch devices instead of relying on mouse hover.
- [x] Column forms stack into single-column layouts on mobile viewports.

### Lesson Editor (Steps 1-6)
- [x] Stepper indicators collapse nicely or hide text labels on mobile screens.
- [x] Large grid containers (like raw outline inputs vs AI suggestions) stack vertically.
- [x] Step action buttons wrap and remain easy to tap.

## Design Notes

- UI surfaces: `UserLayout`, `AdminLayout`, `Subjects`, `SubjectDetail`, `LessonEditorV2`, `Auth`
- Key techniques: CSS Media Queries (`max-width: 768px`), React useState toggles for sidebar/menu drawers, flex-wrap properties.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | None (UI-only change) |
| Integration | Static TypeScript compiler pass |
| E2E | Manual viewport testing under emulated Chrome DevTools viewports (375px, 768px, 1200px) |
| Platform | |
| Release | |

## Harness Delta

- Added custom mobile-responsiveness patterns to vanilla CSS modules.

## Evidence

- Compiled successfully: Run `npm run build` inside `frontend/` succeeds with no errors.
- Visual validation: Emulated responsive layouts on multiple devices (iPhone SE/12, iPad, Samsung Galaxy) inside Chrome DevTools show no horizontal overflow and collapsible sidebars/drawers sliding correctly.

