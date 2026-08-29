export const PAGE_COMPOSITION_GUIDE = {
  purpose: "Compose a useful, personalized page from the user's goal and confirmed name, job role, and game company. Never infer identity, role, or employer from catalog activity. Infer layout unless the user explicitly asks for a particular arrangement.",
  audienceDiscovery: {
    requiredBeforeCreation: true,
    requiredFields: ["firstName", "jobRole", "company"],
    workflow: ["When the user says 'onboard me' or a similar phrase such as 'set me up' or 'get started,' call onboard_audience with operation start.", "Ask one concise survey for the user's first name, game company, and job role; do not infer missing identity details.", "Submit all three answers through onboard_audience. Let the tool resolve strong company typo matches; ask the user only when it returns an ambiguous shortlist.", "After the audience is saved, propose one useful page purpose, the strongest role-and-company-relevant signals, an ordered section list, and one primary action.", "Wait for the user to approve or revise that proposal, then call request_page_composition with the approved proposal before addHtml, addTabs, or create_report."],
    roleApplication: ["Prioritize the decisions and metrics that matter to that role.", "Use vocabulary appropriate to the role without stereotyping.", "State a plain-text next step that advances the role's likely task.", "Explain why the first-view content is relevant to the role."],
    companyApplication: ["Use the confirmed company to frame portfolio-relevant comparisons, opportunities, and risks.", "Prefer useful company context in the welcome, report framing, or CTA instead of repeating the company name in every block.", "When catalog data supports it, compare the company portfolio with an appropriate market cohort and label the comparison clearly.", "Do not imply access to private company data or treat catalog affiliation as proof of the user's identity."],
  },
  decisionOrder: [
    "Complete the agent-led name, company, and role survey, resolve the company, and save the audience.",
    "Propose the user's likely job-to-be-done, single most important action or answer, and the smallest useful page; wait for approval before composition.",
    "Choose a concise page title that communicates the approved purpose, and set it before adding page blocks.",
    "Choose the smallest number of blocks that creates a clear reading order.",
    "Select each block's width from its information density and priority; do not ask the user to choose widths.",
    "For briefings, home pages, and overviews, add a restrained personalized welcome and one clear, non-clickable next-step prompt.",
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
    { name: "Personal briefing", recipe: "Personalized welcome at half width beside the primary KPI; one full-width chart or table below; one clear, non-clickable next-step prompt." },
    { name: "Executive overview", recipe: "Up to three compact third-width KPIs followed by a full-width primary visualization and optional detail tabs." },
    { name: "Engagement overview", recipe: "Four quarter-width KPIs followed by a full-width active-user trend, then two half-width conversion and device views. Use customer_engagement with inheritPageFilters enabled." },
    { name: "Comparison", recipe: "Two half-width peer reports followed by a full-width explanation or detail table." },
    { name: "Deep dive", recipe: "A full-width framing widget followed by a full-width report; use tabs only for genuinely alternate views." },
  ],
  personalization: {
    useWhen: ["the user asks for a home page, briefing, overview, or recurring workspace", "a greeting helps establish whose page this is and when it was prepared"],
    guidance: ["Use personalization once near the top, not in every block.", "Name the confirmed company when it makes the insight or next action more specific.", "Pair the greeting with useful role-and-company context, not decoration.", "State a logical next step as plain text only. Never include Markdown links, HTML anchor elements, href attributes, linked URLs, or button-like links in widget markup."],
    bindings: ["time.greeting", "user.firstName", "user.jobRole", "user.company", "today.long", "today.short", "currentYear", "page.title", "catalog.recordCount"],
    exampleMarkup: "<h2>{{time.greeting}}, {{user.firstName}}</h2><p>Your {{today.long}} catalog briefing connects market signals to your work as {{user.jobRole}} at {{user.company}}.</p><p><strong>Next step:</strong> Ask me to investigate a product or market segment.</p>",
  },
  tabs: {
    chooseWhen: ["views are alternatives rather than simultaneous comparisons", "secondary detail would otherwise make the page long"],
    avoidWhen: ["users need to compare the content side by side", "the content is essential to the first scan"],
  },
  qualityChecks: [
    "The stored first name and job role were confirmed by the user before page creation.",
    "The stored company is an exact or high-confidence typo-resolved catalog match; ambiguous matches were selected by the user.",
    "The approved proposal is stored before the first page mutation.",
    "The composition sets a concise page title that appears in the builder header, browser tab, and page.title binding.",
    "The page has one obvious starting point and one primary next action.",
    "Width reflects content density, not arbitrary symmetry.",
    "Personalization uses company context where it improves relevance and remains restrained.",
    "Widget markup contains no links, anchor elements, href attributes, linked URLs, or button-like links; any next step is plain text.",
    "Tables and dense charts have enough horizontal room.",
    "Tabs hide only optional or alternate content.",
  ],
} as const;
