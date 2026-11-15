# Support role guide

Who this is for: MUSHIN staff with the **Support** role, the base staff role. Support answers customers and watches the
system; it changes no creator data, money or staff accounts.

## Sign in to the Staff Portal

1. Open `#/staff/login` (the same portal as `#/admin/login`). It is marked **staff access only**; customers are sent
   to the customer login.
2. Enter your staff email and password, then the 6-digit code from your authenticator app (TOTP is mandatory; each
   code works once). Wrong passwords pause sign-in for 15 minutes after five attempts.
3. You land on the **Support queue**. Staff accounts are created by a Super Admin, who hands over the one-time password
   and authenticator secret out of band.

## Console sections Support can open

| Section | What Support does there |
|---|---|
| **Support queue** (landing page) | Read and answer customer tickets (below). |
| **Overview** | Platform health at a glance: open tickets, pending removals, running and stuck jobs, eligibility coverage (counts only). |
| **Jobs** | Read discovery job status, step and errors (retry and cancel are Admin). |
| **Workspaces** | Find a customer team (redacted: no contact values). |
| **Workspace access** | Ask a team for consented, read-only, time-boxed access; view the team only while it is granted. |
| **Trial requests** | See founder-assisted trial call-back requests and record a call back (decisions are Super Admin). |
| **Catalogue review** | See creators with unknown or conflicting countries, possible minors, organisations and pending assessments (deciding is Admin). |
| **Creator flags** | See customer reports on creator profiles, with reason, note and source (resolving is Admin). |
| **Security** | Your own sign-in security. |

## Working a ticket

1. **Open** a ticket from the queue (urgent first, then most recent). The thread shows the customer's messages, staff
   replies and internal notes; attachments are scanned before they can be downloaded.
2. **Assign it to yourself** so others know you have it (assigning someone else is Admin).
3. **Reply:** the customer sees it in their Support page; replies are signed with your staff name. Use an
   **internal note** for anything the customer must not see.
4. **Status:** move it as the work progresses:
   `open → in_progress` (you are on it) `→ waiting_on_customer` (you asked them something) `→ resolved` (answered;
   the customer can reopen) `→ closed` (finished). A customer reply reopens a resolved ticket.
5. **Priority:** set low, medium, high or urgent when the customer's choice does not fit.

## Escalating

- **Wrong creator data** (country, minor, brand or celebrity counted as a creator): note it on the ticket and point an
  Admin to the creator in **Catalogue review** or **Creator flags**.
- **A failed or stuck job, provider trouble, refunds or credit questions:** assign to an Admin with an internal note.
- **Data removal requests** from creators go to **Removal requests** (Admin).
- **Bugs:** record the request id (shown in error messages) in an internal note and escalate to an Admin.

## What Support cannot do (the API refuses it)

Decide catalogue reviews or creator flags, retry or cancel jobs, control providers, read the audit log, manage staff,
review removal requests, approve high-impact actions, or decide trials. These need Admin or Super Admin.
