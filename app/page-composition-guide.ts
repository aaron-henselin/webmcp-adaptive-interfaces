export const PAGE_COMPOSITION_GUIDE = {
  purpose: "Compose a useful, personalized page from the user's goal and confirmed name, job role, and game company. Never infer identity, role, or employer from catalog activity. Infer layout unless the user explicitly asks for a particular arrangement.",
  audienceDiscovery: {
    requiredBeforeCreation: true,
    requiredFields: ["firstName", "jobRole", "company"],
    workflow: ["Inspect workspace.audience first.", "If first name or job role is missing, stop and ask the user for it.", "If company is missing, ask for the company name, call search_game_companies, present the returned candidates, and wait for the user to select the closest match; never choose a candidate for them.", "Call compose_page with setAudience and the user-confirmed company candidate before addHtml, addTabs, or create_report.", "Do not guess a role or company from data, browsing behavior, or prior report requests."],
    roleApplication: ["Prioritize the decisions and metrics that matter to that role.", "Use vocabulary appropriate to the role without stereotyping.", "Choose a CTA that advances the role's likely next task.", "Explain why the first-view content is relevant to the role."],
    companyApplication: ["Use the confirmed company to frame portfolio-relevant comparisons, opportunities, and risks.", "Prefer useful company context in the welcome, report framing, or CTA instead of repeating the company name in every block.", "When catalog data supports it, compare the company portfolio with an appropriate market cohort and label the comparison clearly.", "Do not imply access to private company data or treat catalog affiliation as proof of the user's identity."],
  },
  decisionOrder: [
    "Confirm the user's first name, job role, and user-selected company match, then identify their job-to-be-done and single most important action or answer.",
    "Choose the smallest number of blocks that creates a clear reading order.",
    "Select each block's width from its information density and priority; do not ask the user to choose widths.",
    "For briefings, home pages, and overviews, add a restrained personalized welcome and one clear call to action.",
    "Keep the first viewport scannable, then put supporting detail or alternate views in tabs.",
  ],
  widthSelection: {
    full: {
      chooseWhen: ["the block is the page's primary chart or narrative", "a table needs horizontal room", "a tab group organizes a major section", "the content establishes page context"],
      avoidWhen: ["the block is a single compact KPI", "two related summaries benefit from comparison"],
    },
    half: {
      chooseWhen: ["two peer insights should be compared", "a greeting or call-to-action card pairs with a KPI", "a medium chart remains legible beside related context"],
      avoidWhen: ["the table or chart has many categories", "the content is too small to justify half the row"],
    },
    third: {
      chooseWhen: ["the block is a compact KPI, status, date, or short action", "three parallel signals form a balanced summary row"],
      avoidWhen: ["the block contains a table, long prose, or a detailed chart", "fewer than three compact peers exist"],
    },
    quarter: {
      chooseWhen: ["exactly four compact KPIs form one scan", "each value has a short label and concise comparison context"],
      avoidWhen: ["the metric includes a chart, table, or long explanation", "the four values are not genuine peers"],
    },
  },
  compositionPatterns: [
    { name: "Personal briefing", recipe: "Personalized welcome at half width beside the primary KPI; one full-width chart or table below; one clear CTA." },
    { name: "Executive overview", recipe: "Up to three compact third-width KPIs followed by a full-width primary visualization and optional detail tabs." },
    { name: "Engagement overview", recipe: "Four quarter-width KPIs followed by a full-width active-user trend, then two half-width conversion and device views. Use customer_engagement with inheritPageFilters enabled." },
    { name: "Comparison", recipe: "Two half-width peer reports followed by a full-width explanation or detail table." },
    { name: "Deep dive", recipe: "A full-width framing widget followed by a full-width report; use tabs only for genuinely alternate views." },
  ],
  personalization: {
    useWhen: ["the user asks for a home page, briefing, overview, or recurring workspace", "a greeting helps establish whose page this is and when it was prepared"],
    guidance: ["Use personalization once near the top, not in every block.", "Name the confirmed company when it makes the insight or next action more specific.", "Pair the greeting with useful role-and-company context, not decoration.", "Include one action-oriented link when there is a logical next step."],
    bindings: ["time.greeting", "user.firstName", "user.jobRole", "user.company", "today.long", "today.short", "currentYear", "page.title", "catalog.recordCount"],
    exampleMarkup: "<h2>{{time.greeting}}, {{user.firstName}}</h2><p>Your {{today.long}} catalog briefing connects market signals to your work as {{user.jobRole}} at {{user.company}}.</p><a href=\"#catalog-browser\">Explore the catalog</a>",
  },
  tabs: {
    chooseWhen: ["views are alternatives rather than simultaneous comparisons", "secondary detail would otherwise make the page long"],
    avoidWhen: ["users need to compare the content side by side", "the content is essential to the first scan"],
  },
  qualityChecks: [
    "The stored first name and job role were confirmed by the user before page creation.",
    "The stored company is a search candidate explicitly selected by the user, not an agent-inferred match.",
    "The page has one obvious starting point and one primary next action.",
    "Width reflects content density, not arbitrary symmetry.",
    "Personalization uses company context where it improves relevance and remains restrained.",
    "Tables and dense charts have enough horizontal room.",
    "Tabs hide only optional or alternate content.",
  ],
} as const;
