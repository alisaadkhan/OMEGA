# Roles matrix

Two separate kinds of account: **customers** (brand and agency teams; Supabase sign-in, email confirmation required) and
**staff** (MUSHIN employees; own accounts, password + authenticator, security key for admin work). Customer roles never
grant staff permissions, and staff accounts do not sign in as customers. The API enforces every row; the screens follow.

Sources: customer limits in `apps/api/src/modules/*/service.ts` (owner/admin checks); staff permissions in
`apps/api/src/modules/staff/permissions.ts`.

## Routes (frontend, hash routes)

| Route | Who | Notes |
|---|---|---|
| `#/` landing, `#/terms` `#/privacy` `#/refunds` `#/creator-data`, `#/free-trial`, `#/remove-my-data` | Anyone | Public |
| `#/signup`, `#/login`, `#/forgot`, `#/reset-password`, `#/confirmed`, `#/invite/…` | Customers | `#/confirmed` lands confirmed users in the dashboard |
| `#/dashboard` (search, Live Discovery, shortlists, campaigns, inbox, account pages) | Signed-in customers with a **confirmed email** | Otherwise sent to `#/login` |
| `#/staff/login` = `#/admin/login` | Staff | "Staff access only"; links customers to `#/login` |
| `#/staff` = `#/admin` (staff console) | Signed-in staff | Support lands on Support queue, Admin and Super Admin on Overview |

## Customer roles

| Capability | Owner | Admin | Member |
|---|:-:|:-:|:-:|
| Search, Find New Creators, profiles | ✓ | ✓ | ✓ |
| Reveal contacts (credits) | ✓ | ✓ | ✓ |
| Remove revealed contacts | ✓ | ✓ | — |
| Review / flag creators | ✓ | ✓ | ✓ |
| Shortlists and campaigns | ✓ | ✓ | ✓ |
| Export | everything | everything | own shortlists / campaigns |
| Support tickets | ✓ | ✓ | ✓ |
| Billing, plans, credits | ✓ | ✓ | — |
| Rename team, invite / remove members | ✓ | ✓ | — |
| Invite / remove admins, transfer ownership, delete team | ✓ | — | — |
| Grant / end staff support access | ✓ | ✓ | — |

## Staff roles

| Capability (permission) | Support | Admin | Super Admin |
|---|:-:|:-:|:-:|
| Overview, alerts, jobs, workspaces (read) | ✓ | ✓ | ✓ |
| Support tickets: read, reply, notes, priority, assign to self | ✓ | ✓ | ✓ |
| Assign tickets to others | — | ✓ | ✓ |
| Consented read-only workspace access | ✓ | ✓ | ✓ |
| Trial call-backs: read and record | ✓ | ✓ | ✓ |
| Catalogue review and creator flags: read | ✓ | ✓ | ✓ |
| Catalogue review and creator flags: decide (country, organisation, minor; resolve / exclude / dismiss) | — | ✓ | ✓ |
| Retry / cancel jobs, provider controls, alert test | — | ✓ | ✓ |
| Removal requests | — | ✓ | ✓ |
| Audit log, staff directory | — | ✓ | ✓ |
| Approvals (request, decide) | — | ✓ | ✓ |
| Product reviews, usage analytics | — | ✓ | ✓ |
| Staff management, trial decisions and feedback, support performance | — | — | ✓ |
| Security key (WebAuthn) required for these actions | — | ✓ | ✓ |
