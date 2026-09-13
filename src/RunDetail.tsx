import { Component, Suspense, use, useState } from "react";
import type { ReactNode } from "react";
import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { formatDate, formatDuration, formatPace, integer, loadDetail, number } from "./data";
import type { Run } from "./data";
import { svgPosition } from "./svgPosition";

class DetailError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="empty">This workout’s trace could not be loaded. Reload to try again.</p> : this.props.children; }
}

export function Trace({ values, label, unit }: { values: readonly { minute: number, value: number, segment: number }[], label: string, unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (values.length === 0) return <div className="trace-empty"><strong>{label}</strong><p>No samples recorded for this workout.</p></div>;
  const [low = 0, high = 1] = extent(values, point => point.value);
  const [start = 0, end = 1] = extent(values, point => point.minute);
  const y = scaleLinear().domain([low - 5, high + 5]).nice().range([123, 18]);
  const x = scaleLinear().domain([start, end > start ? end : start + 1]).range([38, 360]);
  const paths = new Map<number, { minute: number, value: number }[]>();
  for (const point of values) {
    const segment = paths.get(point.segment);
    if (segment) segment.push(point);
    else paths.set(point.segment, [point]);
  }
  const draw = line<{ minute: number, value: number }>().x(point => x(point.minute)).y(point => y(point.value));
  const point = hover === null ? undefined : values.reduce((nearest, candidate) => Math.abs(candidate.minute - hover) < Math.abs(nearest.minute - hover) ? candidate : nearest, values[0] ?? { minute: 0, value: 0, segment: 0 });
  return <section className="trace">
    <div className="trace-title"><h4>{label}</h4><span>{point ? `${number.format(point.value)} ${unit} · ${number.format(point.minute)} min` : unit}</span></div>
    <svg viewBox="0 0 380 153" role="img" aria-label={`${label} over elapsed minutes`} onPointerLeave={() => setHover(null)} onPointerMove={event => { const point = svgPosition(event.currentTarget, event.clientX, event.clientY); if (point) setHover(x.invert(point.x)); }}>
      {y.ticks(3).map(tick => <g key={tick}><line x1={38} x2={360} y1={y(tick)} y2={y(tick)} className="grid-line"/><text x={30} y={y(tick) + 3} textAnchor="end">{integer.format(tick)}</text></g>)}
      {x.ticks(4).map(tick => <text key={tick} x={x(tick)} y={146} textAnchor="middle">{number.format(tick)}</text>)}
      {[...paths].map(([id, points]) => points.length === 1 && points[0]
        ? <circle key={id} cx={x(points[0].minute)} cy={y(points[0].value)} r={3} fill="var(--accent)"/>
        : <path key={id} d={draw(points) ?? ""} fill="none" stroke="var(--accent)" strokeWidth={1.8}/>)}
      {point ? <g><line x1={x(point.minute)} x2={x(point.minute)} y1={14} y2={124} stroke="var(--ink)" strokeDasharray="3 4"/><circle cx={x(point.minute)} cy={y(point.value)} r={4} fill="var(--accent)"/></g> : null}
    </svg>
    <p className="chart-note">Elapsed minutes from start</p>
  </section>;
}

function Traces({ run }: { run: Run }) {
  const detail = use(loadDetail(run));
  const start = Date.parse(run.start);
  let segment = 0;
  let previous = 0;
  const heart = detail.heartRate.map(sample => {
    const time = Date.parse(sample.time);
    if (previous > 0 && time - previous > 120000) segment += 1;
    previous = time;
    return { minute: (time - start) / 60000, value: sample.bpm, segment };
  });
  const elevation = detail.route.flatMap(point => point.elevation === null ? [] : [{ minute: (Date.parse(point.time) - start) / 60000, value: point.elevation * 3.28084, segment: point.segment }]);
  return <><Trace values={heart} label="Heart rate" unit="bpm"/><Trace values={elevation} label="Elevation" unit="ft"/></>;
}

export function RunDetail({ run }: { run: Run | undefined }) {
  if (!run) return <aside className="panel run-detail"><p className="muted">Select a route or table row to view its details.</p></aside>;
  return <aside className="panel run-detail" data-activity={run.activityType}>
    <h3>{formatDate(run.day)}</h3>
    <p className="muted">{run.indoor === true ? "Indoor " : run.indoor === false ? "Outdoor " : ""}{run.activityType === "run" ? "run" : "walk"} · {run.start.slice(11, 16)} local time</p>
    <dl className="detail-stats">
      <div><dt>Distance</dt><dd>{run.miles === null ? "—" : number.format(run.miles)} <small>mi</small></dd></div>
      <div><dt>Duration</dt><dd>{formatDuration(run.durationSeconds)}</dd></div>
      <div><dt>Avg. pace</dt><dd>{run.pace === null ? "—" : formatPace(run.pace)} <small>/mi</small></dd></div>
      <div><dt>Avg. HR</dt><dd>{run.averageHeartRate === null ? "—" : integer.format(run.averageHeartRate)} <small>bpm</small></dd></div>
    </dl>
    <DetailError key={run.id}><Suspense fallback={<p className="empty">Loading this workout’s traces…</p>}><Traces run={run}/></Suspense></DetailError>
    <div className="detail-foot"><span>{integer.format(run.routePointCount)} GPS points</span><span>{integer.format(run.heartRateCount)} heart-rate samples</span></div>
  </aside>;
}
