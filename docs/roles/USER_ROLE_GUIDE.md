# Customer (brand and agency) guide

Who this is for: people at brands and agencies who use MUSHIN to find Pakistani creators. Customer accounts are
separate from staff accounts: they sign in at the customer login, never at the Staff Portal.

## Team roles

Every customer belongs to a team (workspace) with one of three roles. The API enforces each limit; the screens only
hide what a role cannot do.

| Role | Can do |
|---|---|
| **Owner** | Everything below, plus: invite admins, remove admins, transfer ownership, delete the team. Exactly one per team. |
| **Admin** | Everything a member can, plus: rename the team, invite and remove members, manage billing and credits, export the whole team, remove revealed contacts, grant or end staff support access. |
| **Member** | Search, Find New Creators, open profiles, reveal contacts (credits), shortlists and campaigns, review or flag creators, support tickets; export only the shortlists and campaigns they created. |

## 1. Create an account and confirm your email

1. Open **mushin.io → Create an account** (`#/signup`): name, work email, password, and accept the Terms.
2. You see **"Check your email"** with your address. Open the link in the email. If it did not arrive, use
   **Resend** (available again after 45 seconds).
3. The link opens `#/confirmed`, signs you in and takes you straight to the dashboard with a welcome message. Opened in
   another browser, it confirms the address and asks you to sign in.

Until the email is confirmed you cannot reach the dashboard, search, shortlists or campaigns: the app keeps you on the
login page, and the API refuses every request from an unconfirmed account (`403 email_not_verified`; it checks the
sign-in service's own record, not your browser). An expired or used link says so and offers a new one.

## 2. Sign in

- **Customer login:** `#/login` (email and password; **Forgot password?** sends a reset link).
- The customer login links to the **Staff Portal** (`#/staff/login`) for MUSHIN staff. A staff account does not sign
  in here, and a customer account does not sign in there.
- An invitation link (`#/invite/…`) joins the invited email to the team after sign-in or sign-up.

## 3. Find creators

**Search & Discovery** has two modes:

| | Search Existing Creators (database search) | Find New Creators (Live Discovery) |
|---|---|---|
| What it searches | MUSHIN's checked catalogue of eligible Pakistani creators | The platforms live, for creators MUSHIN does not have yet |
| Price | A small fixed credit price per search; the next page and repeats are free | A quote first (platforms and credits); credits are reserved, then settled; a failed run returns them |
| Results | Only eligible creators (10,000+ followers, Pakistani, active, individual creators) | Each card says **New** or **Already in MUSHIN**, with why it fits |

**Filters:** Platform, Niche, Follower band, Engagement rate, Authenticity, Verified only, Has contact, Fresh only. The
Niche filter shows 15 groups (for example *Fashion & Beauty*, *Education & Finance*, *Comedy & Entertainment*); a group
searches every niche in it, so no creator of a covered niche is missed. Active filters show as removable chips;
**Clear all** and **Reset filters** start over. You can also type a request in plain words and ask MUSHIN to read it:
the AI reading only suggests filters, which you apply. It shows what it understood: each suggested filter is marked
**you said** (written in your request) or **inferred** (deduced by the AI, check it), the topics it noted (not filters:
the search matches the words you typed), and anything that is **not a filter**, such as a campaign purpose ("to promote
a new phone"): results are not ranked for it, so check each profile's recent content for fit. Applying a reading keeps
the filters you already set unless the reading replaces them.

Results say which filters the search ran with (**Filters applied**), and warn if you changed filters on screen since.
An empty search lists every condition it combined; removing one usually brings results, and nothing is changed until
you do.

## 4. Creator profiles

Cards show the photo, platform, name and handle, niche, follower count, engagement rate (median per follower over
recent posts; "—" when it cannot be measured, never 0), contact state and freshness. **View Profile** opens the full
profile with a tab per platform, the evidence behind country and niche, and **Update info** (a paid refresh).

**Contacts:** the card says whether an email or mobile is listed ("Email & mobile available", "Email available ·
Verified/Unverified", "Mobile available", "Collab route in bio", "Not publicly listed") and where it was found. Revealing
the value costs credits; owners and admins can remove revealed contacts.

## 5. Review or flag a creator

Every card and every profile has a small **flag** button (**Review**). It opens a short form:

- **Valid creator:** confirms the profile is right. Counted for the review team; nothing else changes.
- **Report an issue:** choose a reason (*Not an individual creator (brand or celebrity)*, *Wrong location / not
  Pakistani*, *Wrong niche*, *Broken or outdated profile*, *Other*), add a note if useful, and send.

Reports from database search and from Live Discovery go to MUSHIN's review team. A second report on the same creator
updates your first one while it is open. Your name is not shown to the review team.

## 6. Shortlists, campaigns and exports

- **Shortlists:** save creators from cards or profiles; add notes; compare.
- **Campaigns:** add creators, track each one's stage, and send outreach where enabled.
- **Exports:** owners and admins export everything; members export the shortlists and campaigns they created. Every
  download is recorded.

## 7. Credits, plans and support

- **Credits & billing** (account menu): balance, plan, top-ups and history. Billing changes need an owner or admin.
- **Support** (account menu): open a ticket (category and priority), follow the thread, attach images or PDFs, and
  reply. Staff answer in the same thread; you see *New reply* until you open it.
- **Settings:** profile, team members and invitations, staff support access (owner/admin), data export and account
  deletion.
