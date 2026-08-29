# Page composition and company personalization

The builder personalizes pages from three locally stored, user-confirmed audience fields: first name, job role, and game company. The agent owns onboarding, and page mutation remains unavailable until the user has approved the agent's proposal.

## Agent onboarding workflow

1. When the user says “onboard me” or a similar phrase such as “set me up” or “get started,” call `onboard_audience` with `operation: "start"`.
2. Ask one concise survey containing the user's first name, game company, and job role.
3. Call `onboard_audience` with `operation: "submit"` and all three answers.
4. Let the tool resolve the company against the Steam catalog. Exact and decisive typo matches are saved under the canonical catalog name. If the result is ambiguous, ask the user which returned candidate they mean and resubmit with its `companyId`. Never invent a company when no credible match exists.
5. After the audience is saved, propose what page would be most useful. State one purpose, the strongest role-and-company-relevant signals, the ordered sections, and one primary action.
6. Wait for the user to approve or revise the proposal.
7. Call the temporarily registered `request_page_composition` tool with the approved proposal and `userConfirmed: true`.
8. Begin composition with `compose_page` operation `setPageTitle`, using a concise title that reflects the approved purpose.
9. Use `compose_page` and `create_report` to build the approved page.

The workspace persists `audience_required`, `proposal_required`, or `composition_ready`. `compose_page` inspection remains available throughout, but page mutations and report creation reject requests until the approved proposal has moved the workspace to `composition_ready`.

The workspace also persists `pageTitle`. Set it through `compose_page` with `{ "op": "setPageTitle", "title": "…" }` before adding blocks. The same value appears in the builder header, becomes the browser tab title, and resolves the `{{page.title}}` HTML binding. Existing saved pages without a title migrate to “Untitled page.”

The company search index unifies developer and publisher names from the Steam catalog. A selected or corrected company is personalization context, not identity verification and not evidence of access to private company data.

## Using company context well

Company context should make the page more decision-useful. Strong uses include:

- framing a market briefing around the company's visible Steam portfolio;
- comparing that portfolio with a clearly named market or genre cohort;
- prioritizing opportunities, risks, and next actions that fit both the user's role and company;
- using the company once in a welcome or framing block so the page feels intentionally prepared.

Avoid merely repeating the company name in every title, inventing private business facts, or implying that catalog affiliation proves the user's identity. Personalization should be specific but restrained.

HTML widgets can use `{{user.company}}` alongside `{{user.firstName}}` and `{{user.jobRole}}`:

```html
<h2>{{time.greeting}}, {{user.firstName}}</h2>
<p>Your {{today.long}} briefing connects current market signals to your work as {{user.jobRole}} at {{user.company}}.</p>
<p><strong>Next step:</strong> Ask me to investigate a product or market segment.</p>
```

### Widget link policy

HTML widgets are presentation-only. Do not include Markdown links, HTML anchor elements, `href` attributes, linked URLs, or button-like links in widget markup. A URL or fragment identifier may point to a route or element the generated page does not implement, leaving a control that looks actionable but does nothing.

Express calls to action as plain text instead, such as “Next step: Ask me to investigate a product or market segment.” The user can then continue through the agent, which can invoke the appropriate tool.

For reports, use the confirmed company to inform the report question, cohort, title, explanation, and call to action. Do not force a company filter when the broader market is the more useful comparison.

## Report presentation modes

Choose exactly one presentation mode for each report:

- `metric` renders one headline value and requires `metric`.
- `table` renders comparable rows and requires `table`.
- `chart` renders one visualization and requires `visualization`.
- `narrative` renders one concise written finding and requires `narrative`.
- `mixed` renders exactly one headline metric followed by one supporting chart and requires both `metric` and `visualization`.

`mixed` is not a generic combination mode and never renders a table. When a page needs both a chart and tabular detail, create separate chart and table reports and place them sequentially or in tabs.
