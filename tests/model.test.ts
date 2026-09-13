import { describe, expect, test } from "bun:test";
import crossfilter from "@aias/crossfilter";
import { datasetSchema, formatPace } from "../src/data";
import { buildModel, summarize } from "../src/model";

const dataset = datasetSchema.parse(await Bun.file(new URL("../public/data/runs.json", import.meta.url)).json());
const ids = (runs: readonly { id: string }[]) => runs.map(run => run.id).sort();

describe("running archive filters", () => {
  test("date, distance, pace, and heart-rate filters intersect against the real archive", () => {
    const model = buildModel(crossfilter(dataset.runs));
    const first = Date.UTC(2020, 0, 1);
    const last = Date.UTC(2027, 0, 1);
    model.date.filterRange([first, last]);
    model.distance.filterRange([2, 9]);
    model.pace.filterRange([300, 900]);
    model.heart.filterRange([100, 190]);
    const expected = dataset.runs.filter(run => run.day >= first && run.day < last && run.miles !== null && run.miles >= 2 && run.miles < 9 && run.pace !== null && run.pace >= 300 && run.pace < 900 && run.averageHeartRate !== null && run.averageHeartRate >= 100 && run.averageHeartRate < 190);
    expect(expected.length).toBeGreaterThan(0);
    expect(ids(model.source.allFiltered())).toEqual(ids(expected));
    for (const dimension of [model.date, model.distance, model.pace, model.heart]) dimension.filterAll();
    expect(model.source.allFiltered().length).toBe(dataset.runs.length);
  });

  test("histograms ignore their own filter and honor filters on other dimensions", () => {
    const model = buildModel(crossfilter(dataset.runs));
    const count = () => model.distances.all().reduce((sum, bin) => sum + bin.value.run + bin.value.walk, 0);
    model.distance.filterRange([3, 6]);
    expect(count()).toBe(dataset.runs.length);
    model.heart.filterRange([100, 160]);
    expect(count()).toBe(dataset.runs.filter(run => run.averageHeartRate !== null && run.averageHeartRate >= 100 && run.averageHeartRate < 160).length);
    expect(ids(model.source.allFiltered())).toEqual(ids(dataset.runs.filter(run => run.averageHeartRate !== null && run.averageHeartRate >= 100 && run.averageHeartRate < 160 && run.miles !== null && run.miles >= 3 && run.miles < 6)));
  });

  test("overflow pace bin preserves slower runs and missing values remain distinct", () => {
    const model = buildModel(crossfilter(dataset.runs));
    model.pace.filterRange([2400, 2430]);
    expect(ids(model.source.allFiltered())).toEqual(ids(dataset.runs.filter(run => run.pace !== null && run.pace >= 2400)));
    model.pace.filterAll();
    model.heart.filterRange([0, 300]);
    expect(model.source.allFiltered().every(run => run.averageHeartRate !== null)).toBe(true);
    model.heart.filterAll();
    expect(model.source.allFiltered().length).toBe(dataset.runs.length);
  });

  test("dates keep the workout's recorded calendar day and upper bounds are exclusive", () => {
    for (const run of dataset.runs) expect(new Date(run.day).toISOString().slice(0,10)).toBe(run.start.slice(0,10));
    const run = dataset.runs[0];
    if (!run) throw new Error("The archive has no running workouts.");
    const model = buildModel(crossfilter(dataset.runs));
    model.date.filterRange([run.day, run.day + 86400000]);
    expect(ids(model.source.allFiltered())).toEqual(ids(dataset.runs.filter(candidate => candidate.day === run.day)));
  });

  test("summary pace uses only runs with measured positive distance", () => {
    const summary = summarize(dataset.runs);
    const eligible = dataset.runs.filter(run => run.miles !== null && run.miles > 0);
    const totalDistance = eligible.reduce((total, run) => total + (run.miles ?? 0), 0);
    expect(summary.pace).toBeCloseTo(eligible.reduce((total, run) => total + run.durationSeconds, 0) / totalDistance, 8);
    expect(summarize([])).toEqual({ miles: 0, seconds: 0, pace: null, heart: null, heartCount: 0, distanceCount: 0 });
    expect(formatPace(599.8)).toBe("10:00");
  });
});


test("elevation gain intersects other filters and keeps missing values distinct", () => {
  const model = buildModel(crossfilter(dataset.runs));
  const recorded = dataset.runs.filter(run => run.elevationGainFeet !== null);
  expect(recorded.length).toBeGreaterThan(0);
  expect(model.gains.all().find(bin => bin.key === -1)?.value).toEqual({
    run: dataset.runs.filter(run => run.activityType === "run" && run.elevationGainFeet === null).length,
    walk: dataset.runs.filter(run => run.activityType === "walk" && run.elevationGainFeet === null).length,
  });
  model.gain.filterRange([100, 300]);
  model.distance.filterRange([5, 10]);
  const expected = dataset.runs.filter(run => run.elevationGainFeet !== null && run.elevationGainFeet >= 100 && run.elevationGainFeet < 300 && run.miles !== null && run.miles >= 5 && run.miles < 10);
  expect(expected.length).toBeGreaterThan(0);
  expect(ids(model.source.allFiltered())).toEqual(ids(expected));
  expect(model.gains.all().reduce((sum, bin) => sum + bin.value.run + bin.value.walk, 0)).toBe(dataset.runs.filter(run => run.miles !== null && run.miles >= 5 && run.miles < 10).length);
  model.gain.filterAll();
  model.distance.filterAll();
  expect(model.source.allFiltered().length).toBe(dataset.runs.length);
});

test("zero elevation gain remains measurable", () => {
  const run = dataset.runs[0];
  if (!run) throw new Error("Archive contains no workouts");
  const zero = { ...run, elevationGainMeters: 0, elevationGainFeet: 0 };
  const missing = { ...run, id: `${run.id}-missing`, elevationGainMeters: null, elevationGainFeet: null };
  const model = buildModel(crossfilter([zero, missing]));
  model.gain.filterRange([0, 50]);
  expect(ids(model.source.allFiltered())).toEqual([zero.id]);
});

test("activity filters update colored groups while the activity group ignores its own filter", () => {
  const model = buildModel(crossfilter(dataset.runs));
  const walks = dataset.runs.filter(run => run.activityType === "walk");
  const runs = dataset.runs.filter(run => run.activityType === "run");
  expect(walks.length).toBeGreaterThan(0);
  expect(runs.length).toBeGreaterThan(0);
  const totals = () => model.distances.all().reduce((counts, bin) => ({ run: counts.run + bin.value.run, walk: counts.walk + bin.value.walk }), { run: 0, walk: 0 });
  expect(totals()).toEqual({ run: runs.length, walk: walks.length });
  expect(model.distances.all().some(bin => bin.value.run > 0 && bin.value.walk > 0)).toBe(true);
  for (const bin of model.distances.all()) {
    const matching = dataset.runs.filter(run => (run.miles === null ? -1 : Math.floor(run.miles)) === bin.key);
    expect(bin.value).toEqual({
      run: matching.filter(run => run.activityType === "run").length,
      walk: matching.filter(run => run.activityType === "walk").length,
    });
  }
  model.activity.filterExact("walk");
  expect(ids(model.source.allFiltered())).toEqual(ids(walks));
  expect(totals()).toEqual({ run: 0, walk: walks.length });
  expect(model.activities.all()).toEqual([{ key: "run", value: runs.length }, { key: "walk", value: walks.length }]);
  model.distance.filterRange([1, 4]);
  const inRange = dataset.runs.filter(run => run.miles !== null && run.miles >= 1 && run.miles < 4);
  expect(ids(model.source.allFiltered())).toEqual(ids(inRange.filter(run => run.activityType === "walk")));
  expect(totals()).toEqual({ run: 0, walk: walks.length });
  expect(model.activities.all()).toEqual([
    { key: "run", value: inRange.filter(run => run.activityType === "run").length },
    { key: "walk", value: inRange.filter(run => run.activityType === "walk").length },
  ]);
  model.activity.filterAll();
  expect(totals()).toEqual({ run: runs.length, walk: walks.length });
});
