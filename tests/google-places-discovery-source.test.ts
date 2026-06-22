import { describe, expect, it } from "vitest";
import { GooglePlacesDiscoverySource } from "../src/google-places/google-places-discovery-source.js";

describe("GooglePlacesDiscoverySource", () => {
  it("uses Text Search for place_search Discovery Runs and maps place fields", async () => {
    const requests: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }> = [];
    const discoverySource = new GooglePlacesDiscoverySource({
      apiKey: "test-key",
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
          headers: init?.headers,
        });
        return new Response(
          JSON.stringify({
            places: [
              {
                id: "ChIJ-text",
                displayName: { text: "Text Search Cafe" },
                formattedAddress: "10 Main St",
                location: { latitude: 41.5, longitude: -73.9 },
                websiteUri: "https://text-cafe.example",
                nationalPhoneNumber: "(555) 555-0101",
                types: ["cafe"],
                businessStatus: "OPERATIONAL",
                rating: 4.5,
                userRatingCount: 41,
              },
            ],
          }),
        );
      },
    });

    const results = await discoverySource.searchPlaces({
      mode: "place_search",
      searchTerm: "coffee shop",
      searchLocation: {
        label: "Beacon, NY",
        latitude: 41.5,
        longitude: -73.9,
        radiusMeters: 1500,
      },
      discoveryLimit: 7,
    });

    expect(requests[0]?.url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(requests[0]?.body).toEqual({
      textQuery: "coffee shop in Beacon, NY",
      pageSize: 7,
      locationBias: {
        circle: {
          center: { latitude: 41.5, longitude: -73.9 },
          radius: 1500,
        },
      },
    });
    expect(results[0]).toMatchObject({
      googlePlaceId: "ChIJ-text",
      name: "Text Search Cafe",
      formattedAddress: "10 Main St",
      websiteUrl: "https://text-cafe.example",
      categories: ["cafe"],
    });
  });

  it("paginates Text Search until the Discovery Limit is reached", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const discoverySource = new GooglePlacesDiscoverySource({
      apiKey: "test-key",
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ url: String(url), body });

        if (body.pageToken === "second-page") {
          return new Response(
            JSON.stringify({
              places: Array.from({ length: 5 }, (_, index) => ({
                id: `ChIJ-page-two-${index}`,
                displayName: { text: `Page Two Cafe ${index}` },
                types: ["cafe"],
              })),
            }),
          );
        }

        return new Response(
          JSON.stringify({
            places: Array.from({ length: 20 }, (_, index) => ({
              id: `ChIJ-page-one-${index}`,
              displayName: { text: `Page One Cafe ${index}` },
              types: ["cafe"],
            })),
            nextPageToken: "second-page",
          }),
        );
      },
    });

    const results = await discoverySource.searchPlaces({
      mode: "place_search",
      searchTerm: "coffee shop",
      searchLocation: {
        label: "Beacon, NY",
      },
      discoveryLimit: 25,
    });

    expect(results).toHaveLength(25);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.body).toMatchObject({
      pageSize: 20,
      textQuery: "coffee shop in Beacon, NY",
    });
    expect(requests[1]?.body).toMatchObject({
      pageSize: 5,
      pageToken: "second-page",
      textQuery: "coffee shop in Beacon, NY",
    });
  });

  it("uses Nearby Search for radius_search Discovery Runs", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const discoverySource = new GooglePlacesDiscoverySource({
      apiKey: "test-key",
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify({ places: [] }));
      },
    });

    await discoverySource.searchPlaces({
      mode: "radius_search",
      searchTerm: "beauty salon",
      searchLocation: {
        label: "Kingston, NY",
        latitude: 41.927,
        longitude: -73.997,
        radiusMeters: 3000,
      },
      discoveryLimit: 24,
    });

    expect(requests[0]?.url).toBe("https://places.googleapis.com/v1/places:searchNearby");
    expect(requests[0]?.body).toEqual({
      includedTypes: ["beauty_salon"],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: 41.927, longitude: -73.997 },
          radius: 3000,
        },
      },
    });
  });
});
