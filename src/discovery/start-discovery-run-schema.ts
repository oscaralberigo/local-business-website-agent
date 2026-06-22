import { z } from "zod";

export const startDiscoveryRunSchema = z
  .object({
    mode: z.enum(["place_search", "radius_search"]),
    searchTerm: z.string().trim().min(1),
    discoveryLimit: z.coerce.number().int().positive().max(60),
    searchLocation: z.object({
      label: z.string().trim().min(1),
      latitude: z.coerce.number().optional(),
      longitude: z.coerce.number().optional(),
      radiusMeters: z.coerce.number().int().positive().optional(),
      viewport: z
        .object({
          north: z.coerce.number(),
          south: z.coerce.number(),
          east: z.coerce.number(),
          west: z.coerce.number(),
        })
        .optional(),
    }),
  })
  .superRefine((input, context) => {
    if (
      input.mode === "radius_search" &&
      (input.searchLocation.latitude === undefined || input.searchLocation.longitude === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "radius_search requires latitude and longitude",
        path: ["searchLocation"],
      });
    }
  });
