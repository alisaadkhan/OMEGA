## MUSHIN UI SIMPLICITY RULE — IMPORTANT

Make the entire MUSHIN interface as simple and easy to understand as possible.

The goal is that a new user with no technical background can open any page and immediately understand:

* What am I looking at?
* What does this mean?
* What can I do here?
* What should I do next?

### 1. Use simple words

Do not use complicated technical or business terms when a normal word works.

Use:

* “Search Creators” instead of “Creator Discovery”
* “Update Info” instead of “Refresh Enrichment”
* “Contact” instead of “Contact Reveal”
* “Followers” instead of “Audience Size”
* “Last Updated” instead of “Freshness Timestamp”
* “Why this creator?” instead of “Ranking Explanation”
* “Good Match” instead of “High Relevance Score”
* “Email” instead of “Primary Contact Channel”
* “Phone” instead of “Contact Number”
* “Location” instead of “Geographic Attribute”

Technical details can exist in advanced views, but they should not be forced on normal users.

### 2. Do not show everything at once

Never fill the screen with every available piece of data.

Show the most useful information first.

Example creator card:

**Name**
@username

**Instagram · 248K followers**

**Good Match**

**Engagement 5.2%**

**Audience: 72% women · 18–30**

**Lahore**

**Last updated 2 days ago**

Then provide:

**View Profile**

**Compare**

**Save**

**Contact**

Additional details can appear after opening the profile.

### 3. Keep tables easy to scan

The current table example is too dense.

Do not create giant tables with long paragraphs inside cells.

Use short values.

Instead of:

> Creative Strategy, Social Media Management, Media Buying, App Development.

Use:

**Creative Strategy**
**Social Media**
**Media Buying**

Or use small tags/chips.

Every row should be readable in a few seconds.

### 4. One clear action per situation

Avoid showing many competing buttons.

For example:

**Primary:** Contact
**Secondary:** Save
**More:** Compare / Add to List / Update Info

The user should immediately know the main action.

### 5. Explain numbers

Never show a score without explaining what it means.

Bad:

**87.4**

Better:

**87 / 100 — Strong Match**

Then:

**Why?**

* Audience matches
* Strong engagement
* Good niche fit

### 6. Make uncertain information obvious

Never make incomplete or old data look fully reliable.

Use simple labels:

**Verified**

**Updated 2 days ago**

**Needs Update**

**Not Available**

**Estimated**

Do not make the user guess what these states mean.

### 7. Make “Update Info” easy to find

Every important creator profile should have:

**Update Info**

When clicked, show:

> Updating this creator's information...

Then show:

> Updated just now

If some information could not be updated:

> Some information could not be updated.

Never silently fail.

### 8. Keep the main workflow extremely clear

The main MUSHIN flow should feel like:

**Search → Understand → Compare → Save → Contact → Manage**

Do not make users learn complicated systems before they can use the product.

### 9. Use plain explanations for AI

Do not make AI feel complicated.

Instead of:

> AI-generated semantic ranking based on weighted relevance vectors

show:

> **Why this creator matches**
>
> Strong audience match
> Good engagement
> Right niche
> Location matches

The technical AI work should happen behind the interface.

### 10. Do not make the interface look “AI complicated”

Avoid:

* Too many graphs
* Too many scores
* Too many badges
* Too many colored indicators
* Large blocks of technical text
* Excessive menus
* Unnecessary tooltips
* Complicated dashboards
* Decorative elements that distract from the task

MUSHIN should feel **smart because it makes things easier**, not because it shows complicated information.

### 11. Use progressive detail

The first layer should be simple.

The second layer can provide more information.

The third layer can contain technical or advanced details.

Example:

**Creator Profile**

First view:

* Name
* Platform
* Followers
* Match
* Engagement
* Audience
* Location
* Contact
* Update Info

Open more:

* Audience details
* Engagement details
* Content analysis
* Authenticity details
* History
* Sources

Advanced:

* Data source
* Verification method
* Last successful contact
* Confidence
* Raw supporting information

### 12. Design for normal people

Assume the user may be:

* A marketing employee
* An agency owner
* A brand manager
* A business owner
* Someone using MUSHIN for the first time

They should not need to understand:

API
LLM
vector search
enrichment
semantic ranking
worker
pipeline
TTL
provider
schema

Those terms belong in technical documentation and admin areas, not normal product screens.

### 13. Keep the visual design simple

Use:

* Clear spacing
* Strong hierarchy
* Simple cards
* Short text
* Familiar icons
* Clear buttons
* Clean tables
* Calm colors
* Consistent spacing

Avoid:

* Over-designed cards
* Huge gradients
* Excessive rounded containers
* Visual clutter
* Too many different component styles
* Large blocks of text

### 14. The rule for every screen

Before shipping any screen ask:

> **Can someone understand this screen in 5 seconds?**

If not, simplify it.

MUSHIN should make decisions easier, not make users study the interface.

The product should feel:

**Simple outside. Intelligent inside.**

Do not remove the intelligence of MUSHIN.

Hide the complexity behind a simple interface.
