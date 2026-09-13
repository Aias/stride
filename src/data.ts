import { z } from "zod";

export const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  elevation: z.number().nullable(),
  time: z.string().datetime({ offset: true }),
  segment: z.number().int().nonnegative(),
});

export const runSchema = z.object({
  id: z.string(),
  activityType: z.enum(["run", "walk"]),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  durationSeconds: z.number().nonnegative(),
  distanceMeters: z.number().nonnegative().nullable(),
  elevationGainMeters: z.number().nonnegative().nullable(),
  averageHeartRate: z.number().positive().nullable(),
  maxHeartRate: z.number().positive().nullable(),
  indoor: z.boolean().nullable(),
  source: z.string(),
  routePreview: z.array(pointSchema),
  routePointCount: z.number().int().nonnegative(),
  heartRateCount: z.number().int().nonnegative(),
  detailPath: z.string().startsWith("/data/runs/"),
}).transform(run => ({
  ...run,
  elevationGainFeet: run.elevationGainMeters === null ? null : run.elevationGainMeters / 0.3048,
  day: Date.parse(`${run.start.slice(0, 10)}T00:00:00Z`),
  miles: run.distanceMeters === null ? null : run.distanceMeters / 1609.344,
  pace: run.distanceMeters !== null && run.distanceMeters > 0
    ? run.durationSeconds / (run.distanceMeters / 1609.344) : null,
}));

export const datasetSchema = z.object({
  runs: z.array(runSchema),
  metadata: z.object({
    exportedAt: z.string(),
    runCount: z.number(),
    walkCount: z.number(),
    routesCount: z.number(),
    heartRateRunCount: z.number(),
  }),
});

export const detailSchema = z.object({
  route: z.array(pointSchema),
  heartRate: z.array(z.object({ time: z.string().datetime({ offset: true }), bpm: z.number().positive() })),
});

export type Run = z.infer<typeof runSchema>;
export type Dataset = z.infer<typeof datasetSchema>;
export type Point = z.infer<typeof pointSchema>;
export type Detail = z.infer<typeof detailSchema>;

const details = new Map<string, Promise<Detail>>();

export function loadDetail(run: Run): Promise<Detail> {
  const cached = details.get(run.id);
  if (cached) return cached;
  const promise = fetch(run.detailPath).then(async response => {
    if (!response.ok) throw new Error(`Workout details could not be loaded (${response.status}).`);
    return detailSchema.parse(await response.json());
  });
  details.set(run.id, promise);
  return promise;
}

export const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
export const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const formatDate = (day: number) => date.format(day);
export const formatMonth = (day: number) => new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(day);
export function formatPace(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return total >= 3600 ? `${Math.floor(total / 3600)}h ${Math.floor(total % 3600 / 60)}m` : `${Math.floor(total / 60)}m ${total % 60}s`;
}
