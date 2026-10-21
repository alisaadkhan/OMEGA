## MUSHIN UI ACCEPTANCE CRITERIA

The MUSHIN interface must be tested against measurable criteria. A screen is not considered complete only because it looks good. It must also be easy to understand, fast to use, consistent, and usable with real data.

### 1. First-Use Understanding

For each major page, test at least 5 first-time users.

At least **4 out of 5 users** must correctly identify the main purpose of the page within **10 seconds** without assistance.

At least **4 out of 5 users** must correctly identify the main action within **10 seconds**.

### 2. Navigation

A user must be able to reach every main product area from the primary navigation within **2 clicks**.

Primary navigation must remain consistent across desktop pages.

A user must never need to use more than **3 clicks** to return to the main dashboard from any normal product page.

### 3. Search

A user must be able to start a creator search within **10 seconds** of opening the search page.

A basic structured search must require no more than **5 visible input actions** before execution.

Natural-language search must allow the user to review and edit the interpreted filters before results are applied.

### 4. Creator Results

Each creator card must show the most important information without opening the profile:

* Name
* Username
* Platform
* Followers
* Engagement
* Location when available
* Match/relevance indication
* Data status or last updated time

A creator card must not require scrolling horizontally to understand its main information.

### 5. Creator Profile

The main creator profile information must be understandable within **15 seconds**.

The main profile view must expose the following without requiring the user to search through multiple menus:

* Creator identity
* Platforms
* Followers
* Engagement
* Audience information when available
* Location when available
* Contact information/status
* Last updated
* Update Info action
* Save action
* Compare action
* Contact action

### 6. Data Status

Every time-sensitive creator field must have a visible freshness state where applicable.

Examples:

**Verified**

**Updated 2 days ago**

**Needs Update**

**Estimated**

**Unavailable**

The UI must never display unavailable information as an empty-looking value that could be mistaken for valid data.

### 7. Update Info

The **Update Info** action must provide visible feedback within **500 ms** after activation.

While updating, the interface must show a loading state.

When complete, the interface must show the new update time.

If some fields fail to update, the interface must clearly identify the affected fields.

The system must never silently replace existing valid data with empty or failed results.

### 8. Contact Information

A contact must clearly show its status:

**Verified**

**Unverified**

**Stale**

**Invalid**

or **Unavailable**

The user must be able to understand the contact status within **5 seconds**.

A contact marked unavailable must never appear as a normal active contact.

### 9. AI Recommendations

Every recommendation shown to the user must provide a short explanation.

The explanation must contain **at least 2 useful reasons** when enough data exists.

Example:

**Good Match**

* Audience matches target age
* Strong engagement
* Right niche

AI recommendations must not present technical model information as the main explanation.

### 10. Scores

No score may appear without a label or meaning.

Bad:

**87.4**

Acceptable:

**87 / 100 — Strong Match**

A score must be understandable without opening technical documentation.

### 11. Tables

Tables must remain readable with realistic data.

The UI must support:

* Long creator names
* Long company names
* Long emails
* Long locations
* Large follower counts
* Missing values

No important text may be clipped without an accessible way to view it.

Column headers must remain understandable when horizontal scrolling is required.

### 12. Loading States

Every page that waits for backend data must have a loading state.

Loading states must preserve the final layout closely enough to avoid major layout movement.

No blank page may remain visible for more than **1 second** without either a loading state or an actionable status message.

### 13. Empty States

Every major list, search result area, campaign view, and activity area must have an intentional empty state.

Every empty state must answer:

**Why is this empty?**

and provide:

**What should I do next?**

### 14. Error States

Every user-facing backend failure must provide:

* A simple explanation
* A recovery action where possible
* No raw stack traces
* No unexplained error codes as the primary message

Retry actions must be available for retryable failures.

### 15. Button Clarity

Each screen must have **one clearly identifiable primary action**.

Primary actions must not compete with more than **2 visually similar secondary actions** in the same immediate area.

### 16. Consistency

The same action must use the same name throughout the product.

Examples:

Use **Update Info** everywhere.

Do not alternate between:

Refresh

Refresh Data

Update Data

Re-enrich

Sync Profile

unless those actions are genuinely different.

The same rule applies to buttons, statuses, filters, navigation labels, and creator metrics.

### 17. Accessibility

All primary interactive controls must be keyboard accessible.

All interactive elements must have visible focus states.

Normal body text must remain readable against its background.

Touch targets on mobile must be at least **44 × 44 px**.

### 18. Responsive Design

The product must work on:

* Desktop
* Laptop
* Tablet
* Mobile

No horizontal page scrolling should occur because of accidental layout overflow.

Tables may use controlled horizontal scrolling when necessary.

Critical actions such as Search, Save, Update Info, and Contact must remain usable on mobile.

### 19. Performance

For normal application navigation:

**p95 page interaction feedback < 500 ms**

For database-backed views:

**p95 initial usable state < 3 seconds**

For live discovery:

The user must see visible progress within **1 second** after the job starts.

The interface must progressively display successful results rather than waiting for the entire live search to finish.

### 20. Real Data Rule

No production UI may use fake creator information, fake metrics, fake reviews, fake customers, or fake activity.

When real information is unavailable, the UI must show:

**Unavailable**

**Not yet available**

**Needs update**

or another truthful state.

### 21. Decision Simplicity Test

For every major workflow, perform a usability test with at least **5 users**.

At least **4 out of 5 users** must complete the intended task without assistance.

Required tasks include:

* Search for creators
* Apply filters
* Understand a creator result
* Open a creator profile
* Compare creators
* Update creator information
* Check contact status
* Save a creator
* Add a creator to a list
* Start contacting a creator

### 22. Final Acceptance Rule

A page is accepted only when:

* The main purpose is clear within **10 seconds**
* The main action is clear within **10 seconds**
* Loading, empty, error, and unavailable states exist
* Real data can fit without breaking the layout
* No unexplained technical language is required for normal use
* No fake data is shown
* The page works on supported screen sizes
* Keyboard navigation works for primary actions
* The defined task can be completed by at least **4 of 5 test users**

**Core principle:**

> MUSHIN should hide technical complexity behind simple decisions and clear actions.

The user should understand **what they are seeing, why it matters, and what to do next** without needing technical knowledge.
