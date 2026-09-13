import { useState } from "react";
import type { FilterValue } from "@aias/crossfilter";
import { useCrossfilter, useDimensionFilter, useDimensionTop, useGroupAll } from "@aias/crossfilter/react";
import { extent, max } from "d3-array";
import { utcMonth } from "d3-time";
import { formatDate, formatMonth, formatPace, integer, number } from "./data";
import type { Dataset, Run } from "./data";
import { buildModel, summarize } from "./model";
import { Histogram } from "./Histogram";
import { RouteMap } from "./RouteMap";
import { RunDetail } from "./RunDetail";

const tableNumber = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type SortKey = "activityType" | "day" | "indoor" | "miles" | "durationSeconds" | "pace" | "averageHeartRate" | "routePointCount";
const columns: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "day", label: "Date" },
  { key: "activityType", label: "Activity" },
  { key: "indoor", label: "Setting" },
  { key: "miles", label: "Distance", numeric: true },
  { key: "durationSeconds", label: "Duration", numeric: true },
  { key: "pace", label: "Pace", numeric: true },
  { key: "averageHeartRate", label: "Avg. HR", numeric: true },
  { key: "routePointCount", label: "GPS" },
];

function sortValue(run: Run, key: SortKey) {
  if (key === "activityType") return run.activityType === "run" ? 0 : 1;
  if (key === "indoor") return run.indoor === null ? null : Number(!run.indoor);
  if (key === "routePointCount") return Number(run.routePointCount > 0);
  return run[key];
}

function range(value: FilterValue<number> | undefined): [number, number] | null {
  return typeof value === "object" && value !== null ? value : null;
}

export function App({ dataset }: { dataset: Dataset }) {
  const model = useCrossfilter(dataset.runs, buildModel);
  const runs = useDimensionTop(model.source, model.date, Infinity);
  const months = useGroupAll(model.source, model.months);
  const distances = useGroupAll(model.source, model.distances);
  const paces = useGroupAll(model.source, model.paces);
  const gains = useGroupAll(model.source, model.gains);
  const hearts = useGroupAll(model.source, model.hearts);
  const activities = useGroupAll(model.source, model.activities);
  const [activityFilter, setActivity] = useDimensionFilter(model.source, model.activity);
  const [dateFilter, setDate] = useDimensionFilter(model.source, model.date);
  const [distanceFilter, setDistance] = useDimensionFilter(model.source, model.distance);
  const [paceFilter, setPace] = useDimensionFilter(model.source, model.pace);
  const [gainFilter, setGain] = useDimensionFilter(model.source, model.gain);
  const [heartFilter, setHeart] = useDimensionFilter(model.source, model.heart);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(20);
  const [sort, setSort] = useState<{ key: SortKey; direction: "ascending" | "descending" }>({ key: "day", direction: "descending" });
  const sortedRuns = runs.toSorted((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return (left - right) * (sort.direction === "ascending" ? 1 : -1);
  });
  const totals = summarize(runs);
  const selected = dataset.runs.find(run => run.id === selectedId);
  const [firstDay = 0, lastDay = 86400000] = extent(dataset.runs, run => run.day);
  const dateRange = range(dateFilter);
  const chartStart = Number(utcMonth.floor(new Date(firstDay)));
  const chartEnd = Number(utcMonth.offset(utcMonth.floor(new Date(lastDay)), 1));
  const activeFilters = [dateFilter, distanceFilter, paceFilter, heartFilter, gainFilter, activityFilter].filter(value => value !== undefined && value !== null).length;
  const clear = () => { setDate(null); setDistance(null); setPace(null); setHeart(null); setGain(null); setActivity(null); };
  return <div className="app-shell">
    <main>
      <header className="overview"><div><h1>{integer.format(runs.length)} activities</h1><p>{formatDate(firstDay)} — {formatDate(lastDay)}</p></div><button className="reset-all" disabled={activeFilters === 0} onClick={clear}>Reset filters{activeFilters > 0 ? ` (${activeFilters})` : ""}</button></header>
      <div className="activity-legend" role="group" aria-label="Activity filters"><button aria-pressed={activityFilter === null || activityFilter === undefined} onClick={() => setActivity(null)}>All <span className="muted">{integer.format(activities.reduce((sum, activity) => sum + activity.value, 0))}</span></button>{activities.map(activity => <button key={activity.key} data-activity={activity.key} aria-pressed={activityFilter === activity.key} onClick={() => setActivity(activity.key)}>
        <span className="activity-dot"/>{activity.key === "run" ? "Runs" : "Walks"} <span className="muted">{integer.format(activity.value)}</span>
      </button>)}</div>
      <section className="metrics" aria-label="Selected workout statistics">
        <article><span>Total distance</span><strong>{number.format(totals.miles)}<small>mi</small></strong><p>{totals.distanceCount} activities with distance</p></article>
        <article><span>Time active</span><strong>{number.format(totals.seconds / 3600)}<small>hrs</small></strong><p>Recorded workout duration</p></article>
        <article><span>Average pace</span><strong>{totals.pace === null ? "—" : formatPace(totals.pace)}<small>/mi</small></strong><p>Total duration ÷ distance</p></article>
        <article><span>Average heart rate</span><strong>{totals.heart === null ? "—" : integer.format(totals.heart)}<small>bpm</small></strong><p>{totals.heartCount} recorded workout summaries</p></article>
      </section>
      <section className="histograms" aria-label="Linked workout distributions">
        <div className="panel timeline"><Histogram selectedValue={selected?.day} formatSelected={formatDate} title="Activities over time" bins={months} binEnd={value => Number(utcMonth.offset(new Date(value), 1))} domain={[chartStart, chartEnd]} range={dateRange} onRange={setDate} format={formatMonth}/></div>
        <div className="panel"><Histogram selectedValue={selected?.miles} title="Distance" unit="miles/activity" bins={distances.filter(bin => bin.key >= 0)} binEnd={value => value + 1} domain={[0, Math.ceil(max(dataset.runs, run => run.miles ?? 0) ?? 1) + 1]} range={range(distanceFilter)} onRange={setDistance} format={value => `${number.format(value)} mi`}/></div>
        <div className="panel"><Histogram selectedValue={selected?.pace} formatSelected={formatPace} title="Pace" unit="minutes/mile" tickInterval={400} bins={paces.filter(bin => bin.key + 30 > 200)} binEnd={value => (Math.floor(value / 30) + 1) * 30} domain={[200, 2430]} range={range(paceFilter)} onRange={setPace} format={value => value >= 2400 ? "40:00+" : formatPace(value)}/></div>
        <div className="panel"><Histogram selectedValue={selected?.averageHeartRate} title="Heart rate" unit="avg bpm" bins={hearts.filter(bin => bin.key >= 60)} binEnd={value => value + 5} domain={[60, Math.ceil((max(dataset.runs, run => run.averageHeartRate ?? 100) ?? 180) / 5) * 5 + 5]} range={range(heartFilter)} onRange={setHeart} format={value => `${integer.format(value)}`}/></div>
        <div className="panel"><Histogram selectedValue={selected?.elevationGainFeet} title="Elevation gain" unit="ft/activity" bins={gains.filter(bin => bin.key >= 0)} binEnd={value => value + 50} domain={[0, (Math.floor((max(dataset.runs, run => run.elevationGainFeet ?? 0) ?? 0) / 50) + 1) * 50]} range={range(gainFilter)} onRange={setGain} format={value => integer.format(value)}/></div>
      </section>
      <section className="explore"><RouteMap allRuns={dataset.runs} runs={runs} selectedId={selected?.id ?? null} onSelect={setSelectedId}/><RunDetail run={selected}/></section>
      <section className="panel run-log"><div className="section-heading"><h2>{integer.format(runs.length)} activities in this selection</h2></div>
        <div className="table-scroll"><table>
          <thead><tr>{columns.map(column => <th key={column.key} className={column.numeric ? "numeric" : undefined} aria-sort={sort.key === column.key ? sort.direction : undefined}>
            <button className="column-sort" onClick={() => setSort(current => ({ key: column.key, direction: current.key === column.key && current.direction === "ascending" ? "descending" : "ascending" }))}>
              {column.label}{sort.key === column.key ? <span aria-hidden="true">{sort.direction === "ascending" ? " ↑" : " ↓"}</span> : null}
            </button>
          </th>)}</tr></thead>
          <tbody>{sortedRuns.slice(0,visibleCount).map(run => {
            const seconds = Math.round(run.durationSeconds);
            const hours = Math.floor(seconds / 3600);
            return <tr key={run.id} className={selected?.id === run.id ? "selected-row" : ""} onClick={() => setSelectedId(run.id)}>
              <td><button className="run-link" aria-pressed={selected?.id === run.id}>{formatDate(run.day)}</button></td>
              <td data-activity={run.activityType}><span className="activity-label"><span className="activity-dot"/>{run.activityType === "run" ? "Run" : "Walk"}</span></td>
              <td>{run.indoor === true ? "Indoor" : run.indoor === false ? "Outdoor" : "—"}</td>
              <td className="numeric">{run.miles === null ? "—" : tableNumber.format(run.miles)} <span className="table-unit">mi</span></td>
              <td className="numeric">{hours > 0 ? <>{hours}<span className="table-unit">h</span>{" "}</> : null}{Math.floor(seconds % 3600 / 60)}<span className="table-unit">m</span>{" "}{String(seconds % 60).padStart(2, "0")}<span className="table-unit">s</span></td>
              <td className="numeric">{run.pace === null ? "—" : formatPace(run.pace)} <span className="table-unit">/mi</span></td>
              <td className="numeric">{run.averageHeartRate === null ? "—" : integer.format(run.averageHeartRate)} <span className="table-unit">bpm</span></td>
              <td><span className={run.routePointCount > 0 ? "gps-present" : "muted"}>{run.routePointCount > 0 ? "Route" : "—"}</span></td>
            </tr>;
          })}</tbody>
        </table></div>
        {runs.length === 0 ? <div className="empty"><p>No activities match these filters.</p><button onClick={clear}>Reset filters</button></div> : null}
        {visibleCount < runs.length ? <button className="load-more" onClick={() => setVisibleCount(count => count + 30)}>Show more activities <span>{Math.min(visibleCount, runs.length)} of {runs.length}</span></button> : null}
      </section>
      <details className="data-notes"><summary>About your data</summary><p>Running and walking workouts are extracted from your Apple Health export. Dates use the local date recorded with each workout. Distance is shown in miles. Pace uses Apple’s recorded workout duration, which can differ from elapsed GPS time.</p><p>Heart-rate filters use recorded workout averages. The overall heart-rate figure is the mean of those workout averages. Workouts without a recorded average stay in view until a heart-rate range is selected. Elevation gain uses Apple’s recorded total ascent. Workouts without an ascent value stay in view until an elevation range is selected. Individual samples are matched to workout times and recording source. GPS previews are simplified for the overview. Workout details load the full traces.</p><p>This dashboard serves your data locally. The street basemap loads from OpenFreeMap. Map requests reveal the viewed area to that provider; GPS tracks and workout records remain local. The export also contains other activity types, which are excluded from this activity log.</p></details>
    </main>
  </div>;
}
