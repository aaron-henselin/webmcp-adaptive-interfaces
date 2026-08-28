export const PAGE_COMPOSITION_GUIDE = {
  purpose: "Compose a useful, personalized page from the user's goal. Infer the layout unless the user explicitly asks for a particular arrangement.",
  decisionOrder: [
    "Identify the user's job-to-be-done and the single most important action or answer.",
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
  },
  compositionPatterns: [
    { name: "Personal briefing", recipe: "Personalized welcome at half width beside the primary KPI; one full-width chart or table below; one clear CTA." },
    { name: "Executive overview", recipe: "Up to three compact third-width KPIs followed by a full-width primary visualization and optional detail tabs." },
    { name: "Comparison", recipe: "Two half-width peer reports followed by a full-width explanation or detail table." },
    { name: "Deep dive", recipe: "A full-width framing widget followed by a full-width report; use tabs only for genuinely alternate views." },
  ],
  personalization: {
    useWhen: ["the user asks for a home page, briefing, overview, or recurring workspace", "a greeting helps establish whose page this is and when it was prepared"],
    guidance: ["Use personalization once near the top, not in every block.", "Pair the greeting with useful context, not decoration.", "Include one action-oriented link when there is a logical next step."],
    bindings: ["time.greeting", "user.firstName", "today.long", "today.short", "currentYear", "page.title", "catalog.recordCount"],
    exampleMarkup: "<h2>{{time.greeting}}, {{user.firstName}}</h2><p>Your Steam catalog briefing for {{today.long}} is ready.</p><a href=\"#catalog-browser\">Explore the catalog</a>",
  },
  tabs: {
    chooseWhen: ["views are alternatives rather than simultaneous comparisons", "secondary detail would otherwise make the page long"],
    avoidWhen: ["users need to compare the content side by side", "the content is essential to the first scan"],
  },
  qualityChecks: [
    "The page has one obvious starting point and one primary next action.",
    "Width reflects content density, not arbitrary symmetry.",
    "Personalization is useful and restrained.",
    "Tables and dense charts have enough horizontal room.",
    "Tabs hide only optional or alternate content.",
  ],
} as const;
