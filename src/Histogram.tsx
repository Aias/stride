import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { bisectCenter, max, range as numericRange } from "d3-array";
import { brushSelection, brushX } from "d3-brush";
import type { BrushBehavior, D3BrushEvent } from "d3-brush";
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import type { ActivityCounts } from "./model";
import { svgPosition } from "./svgPosition";

type HistogramBin = { key: number; value: ActivityCounts };
type HistogramProps = {
  title: string;
  unit?: string;
  tickInterval?: number;
  selectedValue?: number | null;
  formatSelected?: (value: number) => string;
  bins: readonly HistogramBin[];
  binEnd: (key: number) => number;
  domain: readonly [number, number];
  range: readonly [number, number] | null;
  onRange: (range: [number, number] | null) => void;
  format: (value: number) => string;
};

const chartHeight = 160;
const plotLeft = 0;
const plotTop = 28;
const plotBottom = 132;

function clamp(value: number, lower: number, upper: number) {
  return Math.min(Math.max(value, lower), upper);
}

function useBrush(boundaries: number[], domainStart: number, domainEnd: number, plotRight: number, range: HistogramProps["range"], onRange: HistogramProps["onRange"]) {
  const ref = useRef<SVGGElement>(null);
  const brushRef = useRef<BrushBehavior<unknown>>(null);
  const dragging = useRef(false);
  const draggedBins = useRef<number | null>(null);
  const start = useEffectEvent((event: D3BrushEvent<unknown>) => {
    if (!event.sourceEvent) return;
    dragging.current = true;
    draggedBins.current = null;
    if (event.mode !== "drag" || !event.selection) return;
    const [left, right] = event.selection;
    if (typeof left !== "number" || typeof right !== "number") return;
    const x = scaleLinear().domain([domainStart, domainEnd]).range([plotLeft, plotRight]);
    draggedBins.current = Math.max(1, bisectCenter(boundaries, x.invert(right)) - bisectCenter(boundaries, x.invert(left)));
  });
  const change = useEffectEvent((event: D3BrushEvent<unknown>) => {
    if (!event.sourceEvent) return;
    if (event.selection === null) { onRange(null); return; }
    const [left, right] = event.selection;
    if (typeof left !== "number" || typeof right !== "number") return;
    const x = scaleLinear().domain([domainStart, domainEnd]).range([plotLeft, plotRight]);
    let first = bisectCenter(boundaries, x.invert(left));
    let last = bisectCenter(boundaries, x.invert(right));
    if (event.mode === "drag" && draggedBins.current !== null) {
      first = Math.min(first, boundaries.length - 1 - draggedBins.current);
      last = first + draggedBins.current;
    } else if (first === last) {
      first = Math.min(first, boundaries.length - 2);
      last = first + 1;
    }
    const lower = boundaries[first];
    const upper = boundaries[last];
    if (lower === undefined || upper === undefined) return;
    onRange([lower, upper]);
    const node = ref.current;
    const brush = brushRef.current;
    if (node && brush && (left !== x(lower) || right !== x(upper))) select(node).call(brush.move, [x(lower), x(upper)]);
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const brush = brushX<unknown>()
      .extent([[plotLeft, plotTop], [plotRight, plotBottom]])
      .handleSize(10)
      .on("start", start)
      .on("brush", change)
      .on("end", (event: D3BrushEvent<unknown>) => {
        if (!event.sourceEvent) return;
        dragging.current = false;
        change(event);
      });
    select(node).call(brush);
    brushRef.current = brush;
    return () => {
      select(node).on(".brush", null).selectAll("*").remove();
      brushRef.current = null;
      dragging.current = false;
    };
  }, [domainStart, domainEnd, plotRight]);

  useEffect(() => {
    const node = ref.current;
    const brush = brushRef.current;
    if (!node || !brush || dragging.current) return;
    const x = scaleLinear().domain([domainStart, domainEnd]).range([plotLeft, plotRight]).clamp(true);
    const pixels: [number, number] | null = range ? [x(range[0]), x(range[1])] : null;
    const current = brushSelection(node);
    if (pixels === null && current === null) return;
    if (pixels && current && pixels[0] === current[0] && pixels[1] === current[1]) return;
    select(node).call(brush.move, pixels);
  });
  return ref;
}

export function Histogram({ title, unit, tickInterval, selectedValue, formatSelected, bins, binEnd, domain, range, onRange, format }: HistogramProps) {
  const titleId = useId();
  const clipId = useId();
  const [chartWidth, setChartWidth] = useState(560);
  const [hoveredKey, setHoveredKey] = useState<number | null>(null);
  const chartRef = useCallback((node: SVGSVGElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setChartWidth(Math.max(100, entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const plotRight = chartWidth;
  const domainStart = Math.min(...domain);
  const domainEnd = Math.max(...domain);
  const x = scaleLinear().domain([domainStart, domainEnd]).range([plotLeft, plotRight]);
  const selectedX = selectedValue === null || selectedValue === undefined ? null : x(clamp(selectedValue, domainStart, domainEnd));
  const selectedOutside = selectedValue !== null && selectedValue !== undefined && (selectedValue < domainStart || selectedValue > domainEnd);
  const maximum = max(bins, bin => bin.value.run + bin.value.walk) ?? 0;
  const y = scaleLinear().domain([0, maximum || 1]).range([plotBottom, plotTop + 3]);
  const clipStart = range ? clamp(x(range[0]), plotLeft, plotRight) : plotLeft;
  const clipEnd = range ? clamp(x(range[1]), plotLeft, plotRight) : plotRight;
  const boundaries: number[] = [];
  for (let value = domainStart; value < domainEnd; value = binEnd(value)) boundaries.push(value);
  boundaries.push(domainEnd);
  const brushRef = useBrush(boundaries, domainStart, domainEnd, plotRight, range, onRange);
  const hovered = bins.find(bin => bin.key === hoveredKey);
  const bars = { run: "", walk: "" };
  for (const bin of bins) {
    const left = clamp(x(bin.key), plotLeft, plotRight) + .75;
    const right = Math.max(left + 1, clamp(x(binEnd(bin.key)), plotLeft, plotRight) - .75);
    let bottom = plotBottom;
    for (const activity of ["run", "walk"] satisfies (keyof ActivityCounts)[]) {
      const count = bin.value[activity];
      if (count === 0) continue;
      const top = bottom - Math.max(3, plotBottom - y(count));
      bars[activity] += `M${left},${bottom}V${top}H${right}V${bottom}Z`;
      bottom = top;
    }
  }

  function hover(event: PointerEvent<SVGSVGElement>) {
    const point = svgPosition(event.currentTarget, event.clientX, event.clientY);
    if (!point) return;
    const value = x.invert(point.x);
    setHoveredKey(bins.find(bin => bin.key <= value && value < binEnd(bin.key))?.key ?? null);
  }

  function keyboard(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === "Delete" || event.key === "Backspace" || event.key === "Escape") {
      event.preventDefault(); onRange(null); return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const first = range ? bisectCenter(boundaries, range[0]) : 0;
    const last = range ? bisectCenter(boundaries, range[1]) : 1;
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const movement = clamp(delta, -first, boundaries.length - 1 - last);
    const lower = boundaries[event.shiftKey ? first : first + movement];
    const upper = boundaries[event.shiftKey ? clamp(last + delta, first + 1, boundaries.length - 1) : last + movement];
    if (lower !== undefined && upper !== undefined) onRange([lower, upper]);
  }

  return <section className="histogram" aria-labelledby={titleId}>
    <header className="histogram__header">
      <div className="histogram__heading"><h3 id={titleId} className="histogram__title">{title}</h3>{unit ? <span className="histogram__unit">{unit}</span> : null}</div>
      <button className="histogram__reset" type="button" onClick={() => onRange(null)} disabled={!range}>Clear</button>
    </header>
    <svg ref={chartRef} className="histogram__chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="group" tabIndex={0}
      aria-label={`${title}. Drag to select, move the selection, or resize its edges. Arrow keys move; Shift and arrows resize; Escape clears.`}
      onKeyDown={keyboard} onPointerMove={hover} onPointerLeave={() => setHoveredKey(null)}>
      <defs><clipPath id={clipId}><rect x={clipStart} y={plotTop} width={Math.max(0, clipEnd - clipStart)} height={plotBottom - plotTop}/></clipPath></defs>
      <path className="histogram__bar--context" data-activity="run" d={bars.run} fill="var(--accent)" fillOpacity={0.18}/>
      <path className="histogram__bar--context" data-activity="walk" d={bars.walk} fill="var(--walk)" fillOpacity={0.18}/>
      <path className="histogram__bar--selected" data-activity="run" d={bars.run} fill="var(--accent)" clipPath={`url(#${clipId})`}/>
      <path className="histogram__bar--selected" data-activity="walk" d={bars.walk} fill="var(--walk)" clipPath={`url(#${clipId})`}/>
      <text className="histogram__count-label" x={plotLeft} y={plotTop - 8}>{hovered ? `${format(hovered.key)}–${format(binEnd(hovered.key))}: ${hovered.value.run} ${hovered.value.run === 1 ? "run" : "runs"}, ${hovered.value.walk} ${hovered.value.walk === 1 ? "walk" : "walks"}` : `Up to ${maximum} ${maximum === 1 ? "activity" : "activities"}`}</text>
      <line className="histogram__axis" x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom}/>
      {(tickInterval ? numericRange(domainStart, domainEnd, tickInterval) : x.ticks(5)).map(tick => <g className="histogram__ticks" key={tick} transform={`translate(${x(tick)} 0)`}><line className="histogram__tick-mark" y1={plotBottom} y2={plotBottom + 4}/><text y={plotBottom + 17} textAnchor={x(tick) < 24 ? "start" : x(tick) > plotRight - 24 ? "end" : "middle"}>{format(tick)}</text></g>)}
      <g className="histogram__brush" ref={brushRef}/>
      {selectedX !== null && selectedValue !== null && selectedValue !== undefined ? <g className="histogram__selected-value" pointerEvents="none" aria-label={`Selected activity: ${(formatSelected ?? format)(selectedValue)}${selectedOutside ? " (outside chart range)" : ""}`}>
        <line x1={selectedX} x2={selectedX} y1={plotTop} y2={plotBottom} stroke="#1769ed" strokeWidth={2} strokeDasharray={selectedOutside ? "4 3" : undefined}/>
        {selectedOutside ? <text x={selectedX} y={plotTop - 8} textAnchor={selectedValue < domainStart ? "start" : "end"}>{selectedValue < domainStart ? "← " : ""}{(formatSelected ?? format)(selectedValue)}{selectedValue > domainEnd ? " →" : ""}</text> : null}
      </g> : null}
    </svg>
  </section>;
}
