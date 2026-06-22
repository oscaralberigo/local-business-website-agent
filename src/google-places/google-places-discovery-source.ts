import type {
  BusinessDiscoverySource,
  GooglePlaceResult,
  GooglePlacesSearchRequest,
  SearchLocation,
} from "../discovery/types.js";

type Fetch = typeof fetch;

type GooglePlacesDiscoverySourceConfig = {
  apiKey: string;
  fetch?: Fetch;
};

type GooglePlaceApiResult = {
  id?: string;
  name?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  types?: string[];
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
};

type GooglePlacesApiResponse = {
  places?: GooglePlaceApiResult[];
  nextPageToken?: string;
};

const googlePlacesPageSizeLimit = 20;

const placeFieldMask = [
  "places.id",
  "places.name",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.types",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
].join(",");

const textSearchFieldMask = ["nextPageToken", placeFieldMask].join(",");

export class GooglePlacesDiscoverySource implements BusinessDiscoverySource {
  private readonly apiKey: string;
  private readonly fetch: Fetch;

  constructor(config: GooglePlacesDiscoverySourceConfig) {
    this.apiKey = config.apiKey;
    this.fetch = config.fetch ?? fetch;
  }

  async searchPlaces(request: GooglePlacesSearchRequest): Promise<GooglePlaceResult[]> {
    if (request.discoveryLimit <= 0) {
      return [];
    }

    if (request.mode === "place_search") {
      return this.searchTextPlaces(request);
    }

    return this.searchNearbyPlaces(request);
  }

  private async searchTextPlaces(
    request: GooglePlacesSearchRequest,
  ): Promise<GooglePlaceResult[]> {
    const places: GooglePlaceResult[] = [];
    let pageToken: string | undefined;

    do {
      const remainingResults = request.discoveryLimit - places.length;
      const payload = await this.requestPlaces(
        "https://places.googleapis.com/v1/places:searchText",
        {
          ...this.buildTextSearchRequestBody(request),
          pageSize: Math.min(remainingResults, googlePlacesPageSizeLimit),
          ...(pageToken ? { pageToken } : {}),
        },
        textSearchFieldMask,
      );

      places.push(...(payload.places ?? []).map((place) => this.mapPlace(place)));
      pageToken = payload.nextPageToken;
    } while (pageToken && places.length < request.discoveryLimit);

    return places.slice(0, request.discoveryLimit);
  }

  private async searchNearbyPlaces(
    request: GooglePlacesSearchRequest,
  ): Promise<GooglePlaceResult[]> {
    const payload = await this.requestPlaces(
      "https://places.googleapis.com/v1/places:searchNearby",
      this.buildNearbySearchRequestBody(request),
      placeFieldMask,
    );

    return (payload.places ?? []).map((place) => this.mapPlace(place));
  }

  private async requestPlaces(
    endpoint: string,
    body: Record<string, unknown>,
    fieldMask: string,
  ): Promise<GooglePlacesApiResponse> {
    const response = await this.fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Google Places returned ${response.status}: ${await response.text()}`);
    }

    return (await response.json()) as GooglePlacesApiResponse;
  }

  private buildTextSearchRequestBody(request: GooglePlacesSearchRequest): Record<string, unknown> {
    return {
      textQuery: `${request.searchTerm} in ${request.searchLocation.label}`,
      ...this.locationBias(request.searchLocation),
    };
  }

  private buildNearbySearchRequestBody(request: GooglePlacesSearchRequest): Record<string, unknown> {
    return {
      includedTypes: [toGooglePlaceType(request.searchTerm)],
      maxResultCount: Math.min(request.discoveryLimit, googlePlacesPageSizeLimit),
      locationRestriction: {
        circle: {
          center: {
            latitude: requireCoordinate(request.searchLocation.latitude, "latitude"),
            longitude: requireCoordinate(request.searchLocation.longitude, "longitude"),
          },
          radius: request.searchLocation.radiusMeters ?? 5000,
        },
      },
    };
  }

  private locationBias(searchLocation: SearchLocation): Record<string, unknown> {
    if (searchLocation.latitude === undefined || searchLocation.longitude === undefined) {
      return {};
    }

    return {
      locationBias: {
        circle: {
          center: {
            latitude: searchLocation.latitude,
            longitude: searchLocation.longitude,
          },
          radius: searchLocation.radiusMeters ?? 5000,
        },
      },
    };
  }

  private mapPlace(place: GooglePlaceApiResult): GooglePlaceResult {
    const googlePlaceId = place.id ?? place.name;
    if (!googlePlaceId) {
      throw new Error("Google Places result did not include a place identifier");
    }

    return {
      googlePlaceId,
      name: place.displayName?.text ?? googlePlaceId,
      formattedAddress: place.formattedAddress,
      latitude: place.location?.latitude,
      longitude: place.location?.longitude,
      websiteUrl: place.websiteUri,
      phoneNumber: place.nationalPhoneNumber,
      categories: place.types ?? [],
      businessStatus: place.businessStatus,
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      sourcePayload: place,
    };
  }
}

function requireCoordinate(value: number | undefined, fieldName: string): number {
  if (value === undefined) {
    throw new Error(`radius_search Discovery Runs require searchLocation.${fieldName}`);
  }
  return value;
}

function toGooglePlaceType(searchTerm: string): string {
  return searchTerm.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
