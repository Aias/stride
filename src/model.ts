import type { Crossfilter } from "@aias/crossfilter";
import { utcMonth } from "d3-time";
import type { Run } from "./data";

export type ActivityCounts = { run: number; walk: number };

function addActivity(counts: ActivityCounts, workout: Run) {
  counts[workout.activityType] += 1;
  return counts;
}

function removeActivity(counts: ActivityCounts, workout: Run) {
  counts[workout.activityType] -= 1;
  return counts;
}

function emptyActivityCounts() {
  return { run: 0, walk: 0 };
}

export function buildModel(source: Crossfilter<Run>) {
  const activity = source.dimension(run => run.activityType);
  const date = source.dimension(run => run.day);
  const distance = source.dimension(run => run.miles ?? -1);
  const pace = source.dimension(run => run.pace === null ? -1 : Math.min(run.pace, 2400));
  const gain = source.dimension(run => run.elevationGainFeet ?? -1);
  const heart = source.dimension(run => run.averageHeartRate ?? -1);
  return {
    source, activity, date, distance, pace, heart, gain,
    activities: activity.group(),
    months: date.group(value => Number(utcMonth.floor(new Date(value)))).reduce(addActivity, removeActivity, emptyActivityCounts),
    distances: distance.group(value => value < 0 ? -1 : Math.floor(value)).reduce(addActivity, removeActivity, emptyActivityCounts),
    paces: pace.group(value => value < 0 ? -1 : Math.floor(value / 30) * 30).reduce(addActivity, removeActivity, emptyActivityCounts),
    gains: gain.group(value => value < 0 ? -1 : Math.floor(value / 50) * 50).reduce(addActivity, removeActivity, emptyActivityCounts),
    hearts: heart.group(value => value < 0 ? -1 : Math.floor(value / 5) * 5).reduce(addActivity, removeActivity, emptyActivityCounts),
  };
}

export function summarize(runs: readonly Run[]) {
  let miles = 0;
  let seconds = 0;
  let paceSeconds = 0;
  let heartSum = 0;
  let heartCount = 0;
  let distanceCount = 0;
  for (const run of runs) {
    seconds += run.durationSeconds;
    if (run.miles !== null && run.miles > 0) {
      miles += run.miles;
      paceSeconds += run.durationSeconds;
      distanceCount += 1;
    }
    if (run.averageHeartRate !== null) {
      heartSum += run.averageHeartRate;
      heartCount += 1;
    }
  }
  return { miles, seconds, pace: miles > 0 ? paceSeconds / miles : null,
    heart: heartCount > 0 ? heartSum / heartCount : null, heartCount, distanceCount };
}
