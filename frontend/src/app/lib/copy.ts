export const COPY = {
  searchExisting: "Search Existing Creators",
  searchExistingHint: "Search creators already in MUSHIN. Fast and available immediately.",
  findNew: "Find New Creators",
  findNewHint: "Look for additional creator profiles. May take longer and uses credits.",
  refreshData: "Refresh Creator Data",
  audienceDetails: "Audience Details",
  aiEstimated: "AI-estimated from public signals",
  creatorFit: "Creator Fit",
  authenticity: "Authenticity Signals",
  suspiciousActivity: "Suspicious Activity Signals",
  addToList: "Add to List",
  inList: "In List",
  removeFromList: "Remove from List",
  addToCampaign: "Add to Campaign",
  revealContact: "Reveal contact information",
  priorityRefresh: "Priority Data Refresh",
  searchPlaceholder: "Search for creators…",
  exampleQuery: "Pakistani fashion creators in Lahore",
  navItems: ["Search", "Lists", "Campaigns", "Inbox", "Analytics", "Settings"],
} as const;

export const METRIC_HELP = {
  engagement: "Average likes and comments per post divided by followers, over recent posts.",
  creatorFit: "How closely this creator matches your search or campaign requirements. An estimate, not a guarantee.",
  authenticity:
    "Evidence-based signals about unusual audience or engagement patterns. A signal to review, not proof either way.",
  roas: "Return on ad spend: revenue generated divided by money spent.",
  responseRate: "Creators who replied divided by creators emailed.",
  confirmationRate: "Creators confirmed divided by creators added to the campaign.",
} as const;
