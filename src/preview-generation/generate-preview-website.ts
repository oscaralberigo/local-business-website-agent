import type { ProspectBusinessDetail } from "../discovery/types.js";
import type {
  GeneratedSvelteWebsite,
  OperatorEditableField,
  PreviewArtifactStore,
  PreviewSourceReference,
  PreviewWebsite,
  PreviewWebsiteStore,
  WebsiteBuilderAgent,
  WebsiteDesignerAgent,
} from "./types.js";

export async function generatePreviewWebsite(input: {
  prospectBusiness: ProspectBusinessDetail;
  previewArtifactStore: PreviewArtifactStore;
  previewWebsiteStore: PreviewWebsiteStore;
  websiteBuilderAgent: WebsiteBuilderAgent;
  websiteDesignerAgent: WebsiteDesignerAgent;
}): Promise<PreviewWebsite> {
  const businessContext = input.prospectBusiness.businessContext;
  const websiteAssessment = input.prospectBusiness.websiteAssessment;

  if (!businessContext) {
    throw new Error("Business Context is required before Preview Website generation.");
  }

  if (!websiteAssessment) {
    throw new Error("Website Assessment is required before Preview Website generation.");
  }

  if (!websiteAssessment.previewEligibility.effectiveEligible) {
    throw new Error("Prospect Business is not Preview Eligible.");
  }

  const designPlan = await input.websiteDesignerAgent.design({
    prospectBusiness: input.prospectBusiness,
    businessContext,
    websiteAssessment,
  });
  const generatedWebsite = await input.websiteBuilderAgent.build({
    prospectBusiness: input.prospectBusiness,
    designPlan,
    supportedClaims: businessContext.supportedClaims,
  });
  const slug = previewSlugForProspect(input.prospectBusiness);
  const artifact = await input.previewArtifactStore.writeArtifacts({
    prospectBusinessId: input.prospectBusiness.id,
    slug,
    generatedWebsite,
  });

  return input.previewWebsiteStore.savePreviewWebsite({
    prospectBusinessId: input.prospectBusiness.id,
    slug,
    status: "ready_for_review",
    designPlan,
    contentJson: generatedWebsite.contentJson,
    sourceReferences: sourceReferencesFromSupportedClaims(businessContext.supportedClaims),
    buildMetadata: generatedWebsite.buildMetadata,
    artifact,
    operatorEditableFields: operatorEditableFieldsFromPreview({
      contentJson: generatedWebsite.contentJson,
      designPlan,
    }),
  });
}

export function previewSlugForProspect(prospectBusiness: Pick<ProspectBusinessDetail, "id" | "name">): string {
  const nameSlug = prospectBusiness.name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const idSlug = prospectBusiness.id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);

  return [nameSlug || "preview", idSlug].filter(Boolean).join("-");
}

function sourceReferencesFromSupportedClaims(
  supportedClaims: Array<{
    statement: string;
    evidence: Array<{ sourceId: string; factId: string }>;
  }>,
): PreviewSourceReference[] {
  return supportedClaims.flatMap((claim) =>
    claim.evidence.map((evidence) => ({
      sourceId: evidence.sourceId,
      factId: evidence.factId,
      statement: claim.statement,
    })),
  );
}

function operatorEditableFieldsFromPreview(input: {
  contentJson: GeneratedSvelteWebsite["contentJson"];
  designPlan: unknown;
}): OperatorEditableField[] {
  return [
    ...collectEditableFields(input.contentJson, ["contentJson"]),
    ...collectEditableFields(input.designPlan, ["designPlan"]),
  ];
}

function collectEditableFields(value: unknown, path: string[]): OperatorEditableField[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return [
      {
        path: path.join("."),
        label: labelFromPath(path),
        value,
      },
    ];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectEditableFields(item, [...path, String(index)]));
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => collectEditableFields(item, [...path, key]));
  }

  return [];
}

function labelFromPath(path: string[]): string {
  const label = path
    .filter((segment) => segment !== "contentJson" && !/^\d+$/.test(segment))
    .join(" ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ");

  return label ? label.charAt(0).toUpperCase() + label.slice(1).toLowerCase() : "Field";
}
