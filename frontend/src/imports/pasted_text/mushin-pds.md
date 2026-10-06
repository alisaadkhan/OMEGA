MUSHIN Product Design Specification (PDS)
Volume I — Foundation, Product Vision & Design System
This volume establishes the foundational rules for the entire MUSHIN platform. It defines product philosophy, user experience principles, information architecture principles, layout conventions, reusable components, interaction patterns, and design-system requirements. It serves as the canonical reference for all future Figma work.
1. Product Vision
•	MUSHIN is an AI-powered influencer intelligence platform focused on discovering authentic creators, exposing fake engagement, evaluating creator quality, and enabling brands to build data-driven campaigns.
•	Primary principles: clarity over clutter, trust through transparency, speed without sacrificing accuracy, and enterprise-grade consistency.
•	Target personas: founders, marketing agencies, influencer managers, enterprise brands, analysts, support staff, and platform administrators.
•	Every interface should minimize cognitive load while surfacing the highest-value information first.
2. UX Principles
•	Every page must have a single primary action.
•	Critical metrics remain visible without scrolling when practical.
•	Actions must be reversible whenever possible.
•	Progressive disclosure: advanced controls remain hidden until needed.
•	All destructive actions require confirmation.
•	Never leave users in an indefinite loading state.
3. Information Architecture
•	Persistent left navigation, contextual top bar, workspace selector, notification center, global search, profile menu.
•	Hierarchy: Dashboard → Search → Creator → Lists → Campaigns → Billing → Workspace → Settings. Admin users gain an additional Admin section.
4. Layout System
•	Use reusable page shells with header, content area, optional right insight panel and footer.
•	Every page defines loading, empty, populated, error and offline variants.
•	Cards share consistent header, body and action regions.
•	Tables support filtering, sorting, pagination, bulk selection and responsive collapse.
5. Component Library
•	Buttons: primary, secondary, ghost, destructive, icon-only, loading and disabled variants.
•	Inputs: text, password, search, numeric, tokenized, autocomplete, textarea.
•	Selection controls: checkbox, radio, switch, segmented control, chips.
•	Containers: cards, accordions, tabs, drawers, dialogs, sheets, popovers.
•	Feedback: tooltip, toast, banner, inline validation, progress indicator, skeleton loader.
6. Navigation Standards
•	Breadcrumbs on secondary pages.
•	Command palette accessible globally.
•	Keyboard shortcuts documented.
•	Unsaved changes warnings before navigation.
7. Accessibility
•	Keyboard accessible controls, logical focus order, screen-reader labels, sufficient touch targets, descriptive validation messages.
8. Design QA Checklist
•	Consistent spacing.
•	No clipped text.
•	Responsive at desktop/laptop/tablet/mobile.
•	Empty/loading/error states implemented for every screen.
•	Component variants reused instead of duplicated.
Volume II Preview
Authentication, onboarding, navigation shell, dashboard architecture, widgets, cards, activity feed, credits overview, and interaction specifications.
MUSHIN Product Design Specification - Volume 2
Contents
•	3. Design System Foundation
•	4. Authentication & Session UX
•	5. Dashboard Specification
•	Global UX Rules
3. Design System Foundation
Define one reusable design system. Shared components: buttons, inputs, dropdowns, cards, tables, charts, tabs, modals, drawers, tooltips, badges, pagination, avatars, skeletons, empty states, alerts, toasts. Every component documents default, hover, focus, active, disabled, loading, success and error states. Tables support sorting, filtering, bulk actions and sticky headers.
4. Authentication & Session UX
Specify Login, Signup, Forgot Password, Reset Password, Email Verification, MFA Setup, MFA Challenge and Session Expired. Include validation rules, inline errors, server errors, redirects, remember-me, password visibility, password strength, resend cooldowns and account lockout messaging.
5. Dashboard Specification
Dashboard contains welcome header, credit balance, subscription, quick actions, usage analytics, recent searches, saved lists, campaign summary, activity feed and notifications. Every widget defines loading skeletons, empty states, retry behavior, refresh logic and navigation targets.
Global UX Rules
Dedicated pages for 401,403,404,409,429,500, Maintenance, Offline, Workspace Missing and No Credits. 404 theme: 'Lost in the Noise' with actions to Search, Dashboard and Home. Prefer skeleton loaders over spinners.
MUSHIN Product Design Specification – Volume 3
Volume 3 focuses entirely on the Search experience—the core workflow of MUSHIN. It defines every screen, interaction, state, and UX requirement required to recreate the feature in Figma without referencing the codebase.
6. Search Architecture
Search is divided into Database Search, Live Search, Hybrid Search, Saved Searches, Search History, Search Jobs, Results, Comparison, Bulk Operations and Export.
Search Landing
Persistent global search bar, advanced filters drawer, recent searches, suggested templates, saved filters, remaining credits indicator, CTA to start search.
Advanced Filters
Platform, location, language, category, audience size, engagement, authenticity score, fake follower %, growth, contact availability, verification, posting frequency, keywords, exclusions. Filters support presets, reset, save, share and URL persistence.
Search Execution
Validate credits, estimate cost, queue job, show progress timeline, realtime status, cancel, retry and resume where applicable.
Results Grid
Creator cards include avatar, name, platform, followers, engagement, authenticity, audience summary, contact status, tags, actions (view, compare, add to list, campaign).
Bulk Actions
Multi-select, add to list, export CSV, compare, assign campaign, tag, remove selection.
Comparison View
Side-by-side metrics with differences highlighted. Sticky comparison header and export.
Loading & Empty States
Skeleton cards, progressive loading, partial results, no-results suggestions, retry prompts, offline recovery.
Error States
Invalid filters, insufficient credits, provider unavailable, timeout, cancelled search, rate limit, expired session, server error.
Micro-interactions
Animated progress bar, optimistic saves, hover metrics, keyboard shortcuts, smooth filter chips, inline validation.
MUSHIN Product Design Specification
Volume 4A — Search System
Purpose
This volume defines the complete Search System for MUSHIN. It serves as the canonical blueprint for Figma designers and frontend engineers.

1. Search Philosophy
Search is the core workflow. Users discover creators through fast, trustworthy, AI-assisted querying with clear progress, credit visibility, and resilient error handling.
2. Search Entry
Global search bar, placeholder text, recent searches dropdown, AI suggestions, keyboard shortcuts, validation, debounce, submit behavior, loading indicators.
3. Filters
Platform, location, language, niche, audience size, engagement, authenticity score, follower ranges, verification, contact availability, advanced boolean filters, save/reset.
4. Search Execution
Database-first search, optional live enrichment, credit reservation, job creation, realtime progress, cancellation, retry semantics, timeout handling.
5. Results
Responsive grid/table toggle, creator cards, sorting, pagination, bulk selection, compare drawer, save to list, export CSV, profile navigation.
6. States
Skeleton loaders, empty state, no results, partial results, provider unavailable, rate limit, insufficient credits, expired session, offline.
7. Realtime
Progress bar, provider stages, ETA, streamed results, reconnect behavior, duplicate suppression.
8. Error Catalog
400 invalid query, 401 auth required, 403 permission denied, 404 search job missing, 409 duplicate job, 429 rate limited, 500 internal error, provider failure, network timeout.
9. UX Rules
Every action has feedback. Long tasks show progress. Dangerous actions require confirmation. Never silently fail.
10. Figma Specification
Auto Layout, reusable components, variants for every button/input/card, interactive prototypes for all states, named frames, reusable search card component.
Detailed Screen Specification 1
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 1. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 2
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 2. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 3
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 3. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 4
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 4. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 5
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 5. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 6
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 6. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 7
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 7. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 8
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 8. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 9
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 9. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 10
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 10. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 11
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 11. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 12
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 12. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 13
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 13. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 14
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 14. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 15
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 15. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 16
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 16. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 17
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 17. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 18
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 18. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 19
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 19. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 20
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 20. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 21
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 21. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 22
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 22. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 23
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 23. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 24
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 24. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 25
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 25. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 26
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 26. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 27
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 27. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 28
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 28. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 29
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 29. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 30
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 30. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 31
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 31. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 32
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 32. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 33
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 33. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 34
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 34. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 35
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 35. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 36
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 36. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 37
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 37. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 38
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 38. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 39
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 39. This section is intended to be expanded into the full production specification.
Detailed Screen Specification 40
Describe layout hierarchy, component spacing, interactions, hover/focus/disabled/loading states, accessibility behavior, API contract expectations, analytics events, telemetry, error recovery, responsive behavior, and prototype links for Search screen subsection 40. This section is intended to be expanded into the full production specification.
MUSHIN Product Design Specification
Volume 4B — Creator Intelligence
Canonical specification for Creator Profile and Intelligence workflows.
Creator Profile Layout
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Creator Profile Layout.
Header
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Header.
Authenticity Score
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Authenticity Score.
Audience Analytics
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Audience Analytics.
Engagement Analysis
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Engagement Analysis.
Fake Engagement Detection
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Fake Engagement Detection.
Contact Reveal
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Contact Reveal.
Social Accounts
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Social Accounts.
Content Insights
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Content Insights.
Growth Trends
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Growth Trends.
Brand Safety
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Brand Safety.
Lists Integration
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Lists Integration.
Campaign Integration
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Campaign Integration.
Refresh Pipeline
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Refresh Pipeline.
Timeline
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Timeline.
Loading States
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Loading States.
Empty States
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Empty States.
Error States
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Error States.
Responsive Behavior
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Responsive Behavior.
Accessibility
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Accessibility.
Telemetry
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Telemetry.
Figma Components
Define complete UX, component hierarchy, buttons, menus, drawers, cards, charts, loading, empty, success, warning, permissions, analytics events, and API contracts for Figma Components.
Detailed Specification 1
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 2
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 3
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 4
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 5
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 6
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 7
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 8
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 9
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 10
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 11
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 12
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 13
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 14
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 15
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 16
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 17
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 18
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 19
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 20
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 21
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 22
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 23
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 24
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 25
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 26
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 27
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 28
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 29
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 30
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 31
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 32
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 33
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 34
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 35
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 36
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 37
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 38
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 39
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 40
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 41
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 42
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 43
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 44
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 45
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 46
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 47
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 48
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 49
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
Detailed Specification 50
Expand into production-ready Figma instructions including Auto Layout, variants, interactions, hover/focus/disabled states, responsive rules, and engineering handoff notes.
MUSHIN Product Design Specification
Volume 4C

Admin Monitoring
Detailed layouts for system health, queues, jobs, provider status, API usage, alerts, audit logs, feature flags, incident timeline, and operational dashboards. Every table defines filters, sorting, pagination, bulk actions, empty/loading/error states.
Support Console
User lookup, impersonation flow, workspace inspection, credit adjustments, billing history, activity timeline, search replay, permission matrix, and escalation workflow.
Notifications
Toast hierarchy, notification center, read/unread behavior, batching, priorities, retries, and delivery states.
Error Experiences
400,401,403,404,409,429,500, maintenance, offline, session expired, workspace missing, no credits, search failed. Each page specifies illustration placement, CTA hierarchy, recovery actions, and messaging tone.
Microinteractions
Hover, focus, pressed, drag, skeleton transitions, optimistic updates, progress indicators, realtime animations, and accessibility behavior.
Responsive Rules
Desktop, laptop, tablet, mobile layouts, navigation collapse rules, adaptive tables/cards, spacing, and touch interactions.
Accessibility
Keyboard navigation, focus order, ARIA expectations, contrast validation, announcements, reduced motion, and screen-reader behavior.
Figma Build Standards
Page hierarchy, frame naming, Auto Layout, variants, variables, component organization, prototyping links, QA checklist, developer handoff rules.
Completion Note
Volume 4C completes the Admin, Support, Notifications, Error Handling, Responsive, Accessibility, and Figma implementation specification. Together with Volumes 1–4B it forms the foundation for the full MUSHIN Product Design Specification.
MUSHIN Product Design Specification
Volume 4D
Volume 4D — Advanced System States, QA, and Design Governance
This volume defines every remaining cross-cutting experience required to produce a production-grade Figma file. It focuses on feature flags, system states, QA rules, design governance, component lifecycle, analytics instrumentation, design tokens usage, localization readiness, documentation standards, and handoff requirements.
Feature Flags
Document every feature flag, rollout strategy, kill switch, beta badge, hidden navigation rules, admin-only visibility, staged rollout UI behavior, and fallback experience.
System States
Define loading, empty, partial success, degraded service, maintenance, retry, timeout, sync pending, archived, deleted, disabled, locked, premium-only, and experimental states across all modules.
Analytics Instrumentation
Specify every user interaction to be tracked including searches, filters, saves, exports, campaign creation, billing events, onboarding milestones, errors, and performance metrics.
Design Governance
Component ownership, review workflow, naming conventions, deprecation policy, documentation expectations, versioning, and release approval checklist.
Localization & Internationalization
Text expansion rules, RTL readiness, number/date formatting, currencies, locale-aware layouts, translation key strategy, and multilingual QA.
Developer Handoff
Figma annotations, spacing specs, responsive constraints, interaction notes, API mapping references, asset export rules, and acceptance criteria.
Quality Assurance
Visual regression checklist, accessibility audit, responsive validation, interaction testing, component consistency review, typography audit, spacing audit, and production readiness checklist.
Appendices
Glossary, naming standards, route index, component index, page index, modal index, state index, and future extension guidelines.
Outcome
Volumes 1 through 4D collectively define the complete Product Design Specification framework for MUSHIN. The full expanded edition should elaborate every section into hundreds of pages, allowing designers and engineers to recreate the entire product solely from the specification without referencing the implementation.
MUSHIN Product Design Specification
Volume 5 — Workspace, Settings, Notifications, Error States & Micro-interactions

Workspace
Workspace overview, member directory, invitations, roles, ownership transfer, pending invites, activity log, audit trail, storage usage, workspace switching, confirmations, empty/loading/error states.
Settings
Profile, account security, MFA, sessions, notifications, appearance, API keys, integrations, billing preferences, workspace settings, destructive actions, validation, autosave, confirmation dialogs.
Notifications
In-app notification center, toast behavior, priority levels, read/unread, batching, filtering, archive, success/warning/error/info variants, realtime updates.
Error States
400, 401, 403, 404 ('Lost in the Noise'), 409, 429, 500, maintenance, offline, session expired, workspace missing, no credits, failed search. Each page includes primary action, secondary action, diagnostic ID, support link, and graceful recovery guidance.
Micro-interactions
Hover, focus, pressed, drag, transitions, skeletons, optimistic UI, search progress, card expansion, inline validation, loading indicators, success animations, reduced-motion support.
Responsive & Accessibility
Desktop-first with adaptive tablet/mobile layouts, keyboard navigation, ARIA expectations, focus order, color-independent feedback, screen reader announcements.
Figma Guidance
Auto Layout throughout, reusable components, variants, tokens, naming conventions, prototype flows, QA checklist for spacing, alignment, interaction states, accessibility and responsiveness.
MUSHIN Product Design Specification
Volume 6 — Admin Platform, Support Console & Operations
Volume 6 defines every internal operational interface used by administrators, support staff, finance, security, and platform operators. It serves as the blueprint for Figma and frontend implementation.
Admin Dashboard
Global KPIs, live system health, revenue, users, searches, credits, alerts, provider status, quick actions, widgets, drill-down behavior, loading, empty, and failure states.
User Management
Search users, profile drawer, suspension, verification, workspace assignment, billing snapshot, audit history, impersonation entry, bulk actions, confirmations, pagination, filters.
Credits & Billing Admin
Manual adjustments, transaction ledger, credit grants, refunds, disputes, Paddle events, subscription lifecycle, anomaly detection, reconciliation workflow.
Revenue & Analytics
MRR, ARR, churn, conversions, cohort analysis, provider costs, CAC/LTV, exports, charts, date filters, drill-downs.
Search Operations
Live job monitor, queue depth, worker status, provider latency, retries, failed jobs, cost per search, cancellation, diagnostics, telemetry.
API Providers
Health, quotas, usage, failures, credentials, fallback routing, maintenance mode, provider-specific alerts.
Security Center
Security flags, login events, MFA compliance, suspicious activity, rate limits, IP history, audit logs, incident workflow.
Support Console
User lookup, impersonation, ticket timeline, activity logs, credit adjustments, workspace repair, session revocation.
Monitoring & Alerts
Health endpoints, cron status, heartbeat dashboard, webhook failures, notification rules, escalation policies, incident history.
System Settings
Feature flags, environment configuration, maintenance mode, release channels, announcements, global limits, backups.
Operational States
Every page defines default, loading, skeleton, empty, success, warning, error, permission denied, offline and recovery states.
Figma Specification
Frame hierarchy, Auto Layout, reusable admin components, tables, drawers, filters, charts, modals, responsive behavior, QA checklist.
MUSHIN Product Design Specification
Volume 7 — Design System, Components & Figma Architecture
This volume is the canonical design system specification for MUSHIN. It defines reusable UI components, layout rules, interaction patterns, tokens, and Figma architecture so every screen remains visually and functionally consistent.
Design Foundations
8px spacing system, layout grids, breakpoints, elevation, border radius, icon sizing, motion principles, semantic spacing.
Typography Hierarchy
Display, page titles, section headers, card titles, labels, body, captions, helper text, tables, numeric formatting.
Navigation Components
Sidebar, top bar, breadcrumbs, tabs, segmented controls, pagination, command palette, contextual navigation.
Core Components
Buttons, icon buttons, chips, badges, avatars, tags, tooltips, dropdowns, menus, accordions, dividers.
Forms
Inputs, search fields, textareas, selects, comboboxes, multiselects, switches, radios, checkboxes, validation, helper text.
Data Display
Cards, KPI widgets, tables, charts, timelines, activity feeds, avatars, progress bars, score indicators.
Feedback Components
Skeletons, spinners, progress bars, banners, alerts, toast notifications, inline validation, empty states.
Overlay Components
Dialogs, modals, drawers, popovers, context menus, confirmation sheets.
Search Components
Search bar, filter chips, advanced filter panel, creator cards, comparison cards, streaming states.
Figma Architecture
Page hierarchy, Auto Layout rules, variables, tokens, component variants, naming conventions, prototype connections, libraries.
QA Standards
Alignment, spacing consistency, responsive behavior, accessibility, interaction testing, design review checklist.
MUSHIN Product Design Specification
Volume 8
Responsive Design, Accessibility, Motion System, Design Tokens

1. Responsive Framework
•	Desktop (1440–1920)
•	Laptop (1280–1439)
•	Tablet
•	Mobile
•	Adaptive navigation
•	Responsive tables
•	Drawer behavior
•	Breakpoint rules
2. Accessibility (WCAG 2.2 AA)
•	Keyboard navigation
•	Focus management
•	Screen reader labels
•	ARIA expectations
•	Contrast requirements
•	Reduced motion
•	Touch targets
•	Error announcements
3. Motion & Micro-interactions
•	Hover/focus/pressed states
•	Search progress animation
•	Realtime updates
•	Skeleton transitions
•	Modal transitions
•	Toast lifecycle
•	Drag-and-drop feedback
•	Page transitions
4. Design Tokens
•	Spacing scale
•	Border radius
•	Elevation
•	Opacity
•	Motion durations
•	Z-index layers
•	Semantic colors
•	Component tokens
5. Responsive Component Rules
•	Cards
•	Tables
•	Charts
•	Forms
•	Navigation
•	Dialogs
•	Sidebars
•	Filters
6. QA Checklist
•	Accessibility audit
•	Responsive audit
•	Keyboard-only test
•	Screen reader test
•	Performance budget
•	Visual regression
•	Prototype validation
Appendix
This volume defines the responsive behavior, accessibility standards, interaction patterns, motion principles, and reusable design-token architecture that every MUSHIN interface must follow. It serves as the canonical UX specification for enterprise-quality implementation in Figma and frontend engineering.
MUSHIN Product Design Specification – Volume 9
Error Pages & System States
- 400 Bad Request – invalid input or malformed request handling UI state
- 401 Unauthorized – session expired or invalid authentication
- 403 Forbidden – permission denied based on RBAC
- 404 Not Found – styled MUSHIN-themed 'Lost in Noise' page with search redirect and dashboard shortcut
- 409 Conflict – duplicate or conflicting state resolution UI
- 429 Too Many Requests – rate limit warning with cooldown indicator
- 500 Internal Server Error – system failure fallback screen
- Maintenance Mode – scheduled downtime overlay
- Offline Mode – network disconnection state with retry
- Workspace Missing – invalid or deleted workspace redirect
- No Credits – blocked actions with upgrade CTA
- Search Failed – retry + fallback suggestion state
Micro-interactions
- Hover states for cards, buttons, and nav items
- Focus ring behavior for accessibility compliance
- Loading shimmer animations for all data modules
- Search progress streaming animation
- Card expansion transitions
- Drag and drop reorder animations
- Success confirmation micro-animations
- Error shake feedback for invalid inputs
Responsive System
- Desktop layout: full sidebar + expanded panels
- Laptop layout: condensed navigation
- Tablet layout: collapsible sidebar + stacked cards
- Mobile layout: bottom navigation + single column flows
- Adaptive tables with horizontal scroll fallback
- Breakpoint-aware component resizing
Accessibility Requirements
- Full keyboard navigation support across all pages
- Screen reader ARIA labeling for all components
- Logical tab order across forms and dashboards
- Error announcements via live regions
- Contrast-safe component structure (system-level, not theme defined)
- Focus visibility persistence across navigation
Complete User Flows
- New user onboarding → workspace creation → first search
- Search lifecycle → query → streaming → save to list
- Campaign creation → creator selection → outreach flow
- Credits purchase → checkout → webhook → balance update
- Team invite → role assignment → workspace join
- Admin moderation → user lookup → action → audit log
Figma Build Instructions
- Strict frame naming conventions aligned with route structure
- Auto Layout required for all containers
- Reusable component architecture enforced
- Variant-driven button/input systems
- Design tokens mapped to variables (non-color dependent)
- Prototype linking for all primary flows
- Component hierarchy separation: atoms, molecules, organisms
- QA checklist: spacing, alignment, state coverage, responsiveness
MUSHIN Product Design Specification
Volume 6 — Admin Platform, Support Console & Operations
Volume 6 defines every internal operational interface used by administrators, support staff, finance, security, and platform operators. It serves as the blueprint for Figma and frontend implementation.
Admin Dashboard
Global KPIs, live system health, revenue, users, searches, credits, alerts, provider status, quick actions, widgets, drill-down behavior, loading, empty, and failure states.
User Management
Search users, profile drawer, suspension, verification, workspace assignment, billing snapshot, audit history, impersonation entry, bulk actions, confirmations, pagination, filters.
Credits & Billing Admin
Manual adjustments, transaction ledger, credit grants, refunds, disputes, Paddle events, subscription lifecycle, anomaly detection, reconciliation workflow.
Revenue & Analytics
MRR, ARR, churn, conversions, cohort analysis, provider costs, CAC/LTV, exports, charts, date filters, drill-downs.
Search Operations
Live job monitor, queue depth, worker status, provider latency, retries, failed jobs, cost per search, cancellation, diagnostics, telemetry.
API Providers
Health, quotas, usage, failures, credentials, fallback routing, maintenance mode, provider-specific alerts.
Security Center
Security flags, login events, MFA compliance, suspicious activity, rate limits, IP history, audit logs, incident workflow.
Support Console
User lookup, impersonation, ticket timeline, activity logs, credit adjustments, workspace repair, session revocation.
Monitoring & Alerts
Health endpoints, cron status, heartbeat dashboard, webhook failures, notification rules, escalation policies, incident history.
System Settings
Feature flags, environment configuration, maintenance mode, release channels, announcements, global limits, backups.
Operational States
Every page defines default, loading, skeleton, empty, success, warning, error, permission denied, offline and recovery states.
Figma Specification
Frame hierarchy, Auto Layout, reusable admin components, tables, drawers, filters, charts, modals, responsive behavior, QA checklist.
