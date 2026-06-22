import type { BusinessContext } from "../business-context/types.js";
import type { ProspectBusinessDetail } from "../discovery/types.js";
import type { WebsiteAssessment } from "../website-assessment/types.js";
import type {
  PreviewPitchAngle,
  PreviewPrimaryGoal,
  WebsiteDesignerAgent,
  WebsiteDesignPlan,
  WebsiteDesignPlanSection,
} from "./types.js";

export function createWebsiteDesignerAgent(): WebsiteDesignerAgent {
  return {
    async design(input) {
      return designPreviewWebsite(input);
    },
  };
}

function designPreviewWebsite(input: {
  prospectBusiness: ProspectBusinessDetail;
  businessContext: BusinessContext;
  websiteAssessment: WebsiteAssessment;
}): WebsiteDesignPlan {
  const businessKind = classifyBusinessKind(input.prospectBusiness.categories);
  const primaryGoal = primaryGoalForBusinessKind(businessKind);
  const supportedStatements = input.businessContext.supportedClaims
    .filter((claim) => claim.allowedForGeneration)
    .map((claim) => claim.statement);

  return {
    siteType: "multi_section",
    primaryGoal,
    targetCustomer: targetCustomerFor(input.prospectBusiness, primaryGoal),
    pitchAngle: pitchAngleFor(input.websiteAssessment),
    sections: sectionsFor({
      businessKind,
      primaryGoal,
      prospectBusiness: input.prospectBusiness,
      supportedStatements,
      websiteAssessment: input.websiteAssessment,
    }),
    navigation: {
      style: "prominent_cta",
      items: navigationItemsFor(primaryGoal),
    },
    features: featuresFor(primaryGoal, input.businessContext),
    avoid: ["Do not invent prices, hours, reviews, awards, credentials, or testimonials."],
    operatorReviewNotes: [
      ...input.websiteAssessment.reviewNotes,
      "Verify links, contact details, and all editable claims before publication.",
    ],
  };
}

function classifyBusinessKind(categories: string[]): "restaurant" | "service" | "retail" | "local_business" {
  const normalized = categories.map((category) => category.toLowerCase());
  if (normalized.some((category) => /cafe|coffee|restaurant|bakery|bar|food/.test(category))) {
    return "restaurant";
  }

  if (normalized.some((category) => /plumb|roof|electric|salon|spa|repair|contractor/.test(category))) {
    return "service";
  }

  if (normalized.some((category) => /shop|store|retail|boutique/.test(category))) {
    return "retail";
  }

  return "local_business";
}

function primaryGoalForBusinessKind(businessKind: ReturnType<typeof classifyBusinessKind>): PreviewPrimaryGoal {
  switch (businessKind) {
    case "restaurant":
      return "menu_view";
    case "service":
      return "enquiry";
    case "retail":
      return "directions";
    case "local_business":
      return "trust_building";
  }
}

function pitchAngleFor(websiteAssessment: WebsiteAssessment): PreviewPitchAngle {
  switch (websiteAssessment.recommendedPitchAngle) {
    case "first_website":
    case "modern_upgrade":
    case "technical_fix":
    case "social_to_owned_site":
      return websiteAssessment.recommendedPitchAngle;
    case "no_outreach":
    case "uncertain":
      return "other";
  }
}

function targetCustomerFor(prospectBusiness: ProspectBusinessDetail, primaryGoal: PreviewPrimaryGoal): string {
  const location = prospectBusiness.formattedAddress ?? "the local area";
  switch (primaryGoal) {
    case "menu_view":
      return `People near ${location} checking the menu before visiting.`;
    case "enquiry":
      return `Local customers near ${location} comparing service providers.`;
    case "directions":
      return `Nearby shoppers planning a visit around ${location}.`;
    default:
      return `Local customers researching ${prospectBusiness.name}.`;
  }
}

function sectionsFor(input: {
  businessKind: ReturnType<typeof classifyBusinessKind>;
  primaryGoal: PreviewPrimaryGoal;
  prospectBusiness: ProspectBusinessDetail;
  supportedStatements: string[];
  websiteAssessment: WebsiteAssessment;
}): WebsiteDesignPlanSection[] {
  const firstClaim = input.supportedStatements[0] ?? `${input.prospectBusiness.name} is a local business.`;
  const sections: WebsiteDesignPlanSection[] = [
    {
      id: "hero",
      title: input.prospectBusiness.name,
      purpose: "Quickly orient visitors with the business name, location, and strongest supported claim.",
      requiredEvidence: [firstClaim],
      contentGuidance: "Use supported claims only and present this as a preview concept.",
    },
  ];

  if (input.primaryGoal === "menu_view") {
    sections.push({
      id: "menu",
      title: "Menu highlights",
      purpose: "Give restaurant and cafe visitors a clear path to food, drink, or menu information.",
      requiredEvidence: input.supportedStatements,
      contentGuidance: "Use only verified menu or specialty facts, otherwise provide an operator-editable placeholder.",
    });
  }

  if (input.primaryGoal === "enquiry") {
    sections.push({
      id: "services",
      title: "Services",
      purpose: "Help visitors understand what they can ask about before contacting the business.",
      requiredEvidence: input.supportedStatements,
      contentGuidance: "Only list services supported by Business Context facts.",
    });
  }

  sections.push({
    id: "visit",
    title: "Visit or contact",
    purpose: "Make the next step clear without adding live booking, payment, or form behavior.",
    requiredEvidence: [input.prospectBusiness.formattedAddress ?? "Business location from discovery record."],
    contentGuidance: "Prefer call, directions, menu, or enquiry CTAs over unsupported live integrations.",
  });

  return sections;
}

function navigationItemsFor(primaryGoal: PreviewPrimaryGoal): string[] {
  if (primaryGoal === "menu_view") {
    return ["Home", "Menu", "Visit"];
  }

  if (primaryGoal === "enquiry") {
    return ["Home", "Services", "Contact"];
  }

  return ["Home", "About", "Visit"];
}

function featuresFor(primaryGoal: PreviewPrimaryGoal, businessContext: BusinessContext): WebsiteDesignPlan["features"] {
  const sourceUrl = businessContext.sources.find((source) => source.url)?.url ?? "Operator editable placeholder.";
  if (primaryGoal === "menu_view") {
    return [
      {
        name: "Menu CTA",
        purpose: "Let visitors inspect menu information when a public menu URL is verified.",
        evidence: sourceUrl,
      },
    ];
  }

  if (primaryGoal === "enquiry") {
    return [
      {
        name: "Enquiry CTA",
        purpose: "Give prospective customers a clear next step without submitting a live form.",
        evidence: sourceUrl,
      },
    ];
  }

  return [];
}
