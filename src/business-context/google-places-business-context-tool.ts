import type { BusinessContextResearchTool } from "./types.js";

export function createGooglePlacesBusinessContextTool(): BusinessContextResearchTool {
  return {
    toolName: "google_places",
    async gather({ prospectBusiness }) {
      const sourceId = `google-places:${prospectBusiness.googlePlaceId}`;
      const facts = [
        factFromValue({
          sourceId,
          label: "Business name",
          value: prospectBusiness.name,
        }),
        factFromValue({
          sourceId,
          label: "Business address",
          value: prospectBusiness.formattedAddress,
        }),
        factFromValue({
          sourceId,
          label: "Business website",
          value: prospectBusiness.websiteUrl,
        }),
        prospectBusiness.categories.length > 0
          ? factFromValue({
              sourceId,
              label: "Business categories",
              value: prospectBusiness.categories.join(", "),
            })
          : undefined,
      ].filter((fact) => fact !== undefined);

      return {
        sources: [
          {
            id: sourceId,
            sourceType: "google_places",
            title: `${prospectBusiness.name} Google Places discovery data`,
            retrievedAt: prospectBusiness.lastSeenAt,
            termsCompliance: {
              allowed: true,
              checkedAt: new Date(),
              notes: "Stored Google Places discovery data from the approved Business Discovery Source.",
            },
          },
        ],
        facts,
        excludedResearchData: [],
      };
    },
  };
}

function factFromValue(input: {
  sourceId: string;
  label: string;
  value?: string;
}) {
  if (!input.value) {
    return undefined;
  }

  return {
    sourceId: input.sourceId,
    label: input.label,
    value: input.value,
    allowedForGeneration: true,
  };
}
