import type {
  BusinessDiscoverySource,
  DiscoveryRunDetail,
  ProspectRegistry,
  StartDiscoveryRunInput,
} from "./types.js";

export async function runDiscovery(input: {
  request: StartDiscoveryRunInput;
  discoverySource: BusinessDiscoverySource;
  registry: ProspectRegistry;
}): Promise<DiscoveryRunDetail> {
  const discoveryRun = await input.registry.createDiscoveryRun(input.request);

  try {
    const providerResults = await input.discoverySource.searchPlaces(input.request);
    const limitedResults = providerResults.slice(0, input.request.discoveryLimit);

    for (const [index, place] of limitedResults.entries()) {
      await input.registry.recordDiscoveredProspect({
        discoveryRunId: discoveryRun.id,
        rank: index + 1,
        place,
      });
    }

    await input.registry.completeDiscoveryRun({
      discoveryRunId: discoveryRun.id,
      providerResultCount: providerResults.length,
      processedResultCount: limitedResults.length,
    });
  } catch (error) {
    await input.registry.failDiscoveryRun({
      discoveryRunId: discoveryRun.id,
      failedStep: "google_places_discovery",
      errorSummary: error instanceof Error ? error.message : "Google Places discovery failed",
      retryable: true,
    });
  }

  return input.registry.getDiscoveryRunDetail(discoveryRun.id);
}
