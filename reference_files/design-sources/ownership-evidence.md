## 23. Ownership and Evidence

Every UI requirement must have a clear owner and measurable evidence before it is considered complete.

### Ownership

Each requirement must have one primary owner:

| Area                | Primary Owner         | Responsibility                                            |
| ------------------- | --------------------- | --------------------------------------------------------- |
| Visual design       | UI/UX Designer        | Layout, typography, spacing, colors, visual consistency   |
| UX behavior         | Product/UI Designer   | User flow, actions, labels, states and simplicity         |
| Frontend            | Frontend Developer    | Working implementation and responsive behavior            |
| Backend integration | Backend/API Developer | Correct data, API behavior and error handling             |
| Data accuracy       | Data/Backend Owner    | Source, freshness, validation and update behavior         |
| AI behavior         | AI Owner              | Query understanding, scoring and recommendation behavior  |
| Accessibility       | Frontend Owner        | Keyboard use, focus, contrast and accessible controls     |
| QA                  | QA Owner              | Functional testing and acceptance testing                 |
| Product approval    | Product Owner         | Final decision that the page meets the intended user need |

One person may hold multiple roles, but **every requirement must have exactly one primary owner**.

### Evidence Requirement

A requirement cannot be marked complete only because someone says it works.

Each completed requirement must have evidence.

Accepted evidence includes:

**UI/visual**

* Figma screen
* Screenshot
* Design-system reference
* Before/after comparison

**Functional**

* Working browser test
* Screen recording
* Playwright/E2E test
* Unit or integration test where appropriate

**Backend/data**

* API response
* Database record
* Source/provenance record
* Freshness timestamp
* Validation result

**AI**

* Example input and output
* Structured output validation
* Test dataset result
* Recommendation explanation

**Accessibility**

* Keyboard test
* Focus-state screenshot/video
* Contrast check
* Responsive screenshots

### Acceptance Record

Every major page and feature should have a simple acceptance record:

| Requirement                       | Owner        | Status | Evidence                    | Date       |
| --------------------------------- | ------------ | ------ | --------------------------- | ---------- |
| Search page is understandable     | UI/UX        | Passed | Usability test + screenshot | YYYY-MM-DD |
| Search returns real creators      | Frontend/API | Passed | E2E test                    | YYYY-MM-DD |
| Creator data shows freshness      | Data         | Passed | DB/source evidence          | YYYY-MM-DD |
| Update Info works                 | Frontend/API | Passed | Browser recording           | YYYY-MM-DD |
| Contact status is correct         | Data/Backend | Passed | Verification record         | YYYY-MM-DD |
| AI recommendation explains result | AI           | Passed | Evaluation examples         | YYYY-MM-DD |

### Evidence Standards

Evidence must be:

**Specific**
It must prove the exact requirement.

**Current**
Use the latest implementation, not an old screenshot.

**Reproducible**
Another team member should be able to repeat the test.

**Traceable**
The evidence should identify the page, feature, build/version, or test used.

**Real**
Production UI must use real backend behavior or clearly marked test data.

### Usability Evidence

For important user workflows, record:

* Number of users tested
* Task given
* Success count
* Failure count
* Time to complete
* Main problems found

Example:

> Task: Find a Karachi fashion creator with 100K–500K followers
> Users tested: 5
> Completed without help: 4/5
> Average completion time: 42 seconds
> Result: Passed

### Data Evidence

For creator information shown to paying users, retain:

* Source
* Date found
* Date last checked
* Verification state
* Update method
* Previous value when changed
* Reason for change when known

For contact information specifically, retain:

* Contact source
* First seen date
* Last checked date
* Delivery result where MUSHIN sends through the contact
* Bounce/failure count
* Current status

The UI must show a simple version of this information without exposing unnecessary technical details.

### AI Evidence

For AI-generated results, retain:

* User query
* Interpreted requirements
* Model/provider used
* Result
* Validation result
* Main reasons for recommendation
* Evaluation/test result

AI output must not be treated as correct simply because the model produced it.

### Release Gate

A page or feature is **Ready** only when all applicable conditions are satisfied:

* Primary owner assigned
* Acceptance criteria passed
* Required evidence attached
* Real data tested
* Loading/empty/error states tested
* Responsive behavior tested
* Accessibility checked
* No fake production data
* Known issues documented
* Product Owner approval recorded

A feature with missing evidence is **Not Verified**, even if it appears to work.

### Simple Rule

> **No owner = no accountability.**
> **No evidence = not verified.**
> **No passing acceptance test = not ready.**
