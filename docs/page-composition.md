# Page composition and company personalization

The builder personalizes pages from three locally stored, user-confirmed audience fields: first name, job role, and game company. Page creation remains unavailable until all three are present.

## Company confirmation workflow

1. Inspect `workspace.audience` with `describe_steam_catalog`.
2. If the company is missing, ask the user what game company they work for.
3. Call `search_game_companies` with the name they provide.
4. Present the ranked candidates, including developer/publisher role and catalog game count.
5. Wait for the user to select the closest match. The agent must not make this choice.
6. Pass the exact selected `id` and `name` to `compose_page` in the `setAudience` operation.

When the user completes this workflow in the audience form, the page temporarily registers `page_creation_requested`. Its registration emits WebMCP's standard `toolchange` signal and communicates that clicking **Continue to page builder** is an explicit request to create the personalized page next. The tool includes the confirmed audience and composition guide, and it unregisters after the first page block is created.

The search index unifies developer and publisher names from the Steam catalog. A selected company is personalization context, not identity verification and not evidence of access to private company data.

## Using company context well

Company context should make the page more decision-useful. Strong uses include:

- framing a market briefing around the company’s visible Steam portfolio;
- comparing that portfolio with a clearly named market or genre cohort;
- prioritizing opportunities, risks, and next actions that fit both the user’s role and company;
- using the company once in a welcome or framing block so the page feels intentionally prepared.

Avoid merely repeating the company name in every title, inventing private business facts, or implying that catalog affiliation proves the user’s identity. Personalization should be specific but restrained.

HTML widgets can use `{{user.company}}` alongside `{{user.firstName}}` and `{{user.jobRole}}`:

```html
<h2>{{time.greeting}}, {{user.firstName}}</h2>
<p>Your {{today.long}} briefing connects current market signals to your work as {{user.jobRole}} at {{user.company}}.</p>
<a href="#catalog-browser">Explore the catalog</a>
```

For reports, use the confirmed company to inform the report question, cohort, title, explanation, and call to action. Do not force a company filter when the broader market is the more useful comparison.

## Report presentation modes

Choose exactly one presentation mode for each report:

- `metric` renders one headline value and requires `metric`.
- `table` renders comparable rows and requires `table`.
- `chart` renders one visualization and requires `visualization`.
- `narrative` renders one concise written finding and requires `narrative`.
- `mixed` renders exactly one headline metric followed by one supporting chart and requires both `metric` and `visualization`.

`mixed` is not a generic combination mode and never renders a table. When a page needs both a chart and tabular detail, create separate chart and table reports and place them sequentially or in tabs.
