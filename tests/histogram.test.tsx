import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { utcMonth } from "d3-time";
import { Histogram } from "../src/Histogram";

GlobalRegistrator.register();
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
Object.defineProperty(SVGSVGElement.prototype, "createSVGPoint", { value: undefined, configurable: true });
Object.defineProperty(SVGElement.prototype, "clientLeft", { value: 0, configurable: true });
Object.defineProperty(SVGElement.prototype, "clientTop", { value: 0, configurable: true });

type Range = [number, number] | null;

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  await new Promise(resolve => setTimeout(resolve, 0));
});

function ControlledHistogram({ changes, initialRange = null }: { changes: Range[], initialRange?: Range }) {
  const [range, setRange] = useState<Range>(initialRange);
  return <>
    <button type="button" onClick={() => setRange(null)}>External reset</button>
    <Histogram
      title="Distance"
      unit="miles/workout"
      bins={[{ key: 2, value: { run: 1, walk: 0 } }, { key: 6, value: { run: 99, walk: 1 } }]}
      binEnd={key => key + 1}
      domain={[0, 10]}
      range={range}
      onRange={next => { changes.push(next); setRange(next); }}
      format={String}
    />
  </>;
}

function MonthlyHistogram({ changes }: { changes: Range[] }) {
  const [range, setRange] = useState<Range>([Date.UTC(2025, 0, 1), Date.UTC(2025, 3, 1)]);
  return <Histogram
    title="Activities over time"
    bins={[]}
    binEnd={value => Number(utcMonth.offset(new Date(value), 1))}
    domain={[Date.UTC(2025, 0, 1), Date.UTC(2025, 6, 1)]}
    range={range}
    onRange={next => { changes.push(next); setRange(next); }}
    format={value => new Date(value).toISOString()}
  />;
}

async function renderHistogram(changes: Range[], initialRange: Range = null) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<ControlledHistogram changes={changes} initialRange={initialRange}/>));
  return container;
}

function mouse(target: EventTarget, type: "mousedown" | "mousemove" | "mouseup", x: number) {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1,
    clientX: x,
    clientY: 80,
  }));
}

function brushRect(container: HTMLElement, selector: string) {
  const element = container.querySelector<SVGRectElement>(selector);
  if (!element) throw new Error(`Missing brush element: ${selector}`);
  return element;
}

function rectWidth(element: SVGRectElement) {
  return Number(element.getAttribute("width"));
}

test("brush updates the controlled range while the pointer is moving", async () => {
  const changes: Range[] = [];
  const container = await renderHistogram(changes);
  const overlay = brushRect(container, ".histogram__brush .overlay");

  await act(async () => mouse(overlay, "mousedown", 70));
  await act(async () => mouse(window, "mousemove", 170));

  expect(changes.length).toBeGreaterThan(0);
  expect(changes.at(-1)).toEqual([1, 3]);
  const selection = brushRect(container, ".histogram__brush .selection");
  expect(Number(selection.getAttribute("x"))).toBeCloseTo(56, 5);
  expect(rectWidth(selection)).toBeCloseTo(112, 5);

  await act(async () => mouse(window, "mouseup", 170));
});

test("dragging an existing selection moves it without changing its width", async () => {
  const changes: Range[] = [];
  const container = await renderHistogram(changes, [2, 4]);
  const selection = brushRect(container, ".histogram__brush .selection");
  const before = rectWidth(selection);
  const start = Number(selection.getAttribute("x")) + before / 2;

  await act(async () => mouse(selection, "mousedown", start));
  await act(async () => mouse(window, "mousemove", start + 60));

  expect(rectWidth(selection)).toBeCloseTo(before, 5);
  expect(changes.at(-1)).toEqual([3, 5]);
  expect(Number(selection.getAttribute("x"))).toBeCloseTo(168, 5);

  await act(async () => mouse(window, "mouseup", start + 60));
});

test("dragging across irregular month widths preserves the selected bin count", async () => {
  const changes: Range[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<MonthlyHistogram changes={changes}/>));
  const selection = brushRect(container, ".histogram__brush .selection");
  const start = Number(selection.getAttribute("x")) + rectWidth(selection) / 2;

  await act(async () => mouse(selection, "mousedown", start));
  await act(async () => mouse(window, "mousemove", start + 60));

  expect(changes.at(-1)).toEqual([Date.UTC(2025, 1, 1), Date.UTC(2025, 4, 1)]);

  await act(async () => mouse(window, "mouseup", start + 60));
});

test("dragging a resize handle changes the selection width", async () => {
  const changes: Range[] = [];
  const container = await renderHistogram(changes, [2, 4]);
  const selection = brushRect(container, ".histogram__brush .selection");
  const handle = brushRect(container, ".histogram__brush .handle--e");
  const before = rectWidth(selection);
  const start = Number(handle.getAttribute("x")) + rectWidth(handle) / 2;

  await act(async () => mouse(handle, "mousedown", start));
  await act(async () => mouse(window, "mousemove", start + 60));

  expect(rectWidth(selection)).toBeGreaterThan(before);
  expect(changes.at(-1)).toEqual([2, 5]);
  expect(rectWidth(selection)).toBeCloseTo(168, 5);

  await act(async () => mouse(window, "mouseup", start + 60));
});

test("external range reset clears the brush without callback feedback", async () => {
  const changes: Range[] = [];
  const container = await renderHistogram(changes, [2, 4]);
  const button = [...container.querySelectorAll("button")].find(element => element.textContent === "External reset");
  if (!button) throw new Error("Missing external reset button");
  expect(rectWidth(brushRect(container, ".histogram__brush .selection"))).toBeGreaterThan(0);

  await act(async () => {
    button.click();
    await Promise.resolve();
  });

  expect(rectWidth(brushRect(container, ".histogram__brush .selection"))).toBe(0);
  expect(changes).toEqual([]);
});

test("sparse nonempty bins remain visible and the chart has no range inputs", async () => {
  const container = await renderHistogram([]);
  const bars = container.querySelector<SVGPathElement>(".histogram__bar--context");
  if (!bars) throw new Error("Missing histogram bars");

  expect(bars.getAttribute("d")).toContain("V129");
  expect(container.querySelector('input[type="range"]')).toBeNull();
});

test("pace covers walking speeds with evenly spaced ticks from 3:20", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Histogram title="Pace" unit="minutes/mile" tickInterval={400} bins={[{ key: 240, value: { run: 1, walk: 0 } }]} binEnd={value => (Math.floor(value / 30) + 1) * 30} domain={[200, 2430]} range={null} onRange={() => {}} format={value => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`}/>));
  expect([...container.querySelectorAll(".histogram__ticks text")].map(label => label.textContent)).toEqual(["3:20", "10:00", "16:40", "23:20", "30:00", "36:40"]);
});

test("run and walk segments stack with visible sparse counts and share the selected range", async () => {
  const container = await renderHistogram([], [2, 4]);
  const runs = container.querySelector<SVGPathElement>('.histogram__bar--selected[data-activity="run"]');
  const walks = container.querySelector<SVGPathElement>('.histogram__bar--selected[data-activity="walk"]');
  if (!runs || !walks) throw new Error("Missing activity histogram paths");
  expect(runs.getAttribute("fill")).toBe("var(--accent)");
  expect(walks.getAttribute("fill")).toBe("var(--walk)");
  expect(walks.getAttribute("clip-path")).toBe(runs.getAttribute("clip-path"));
  const runSegments = [...(runs.getAttribute("d") ?? "").matchAll(/M([\d.]+),([\d.]+)V([\d.]+)/g)];
  const walkSegments = [...(walks.getAttribute("d") ?? "").matchAll(/M([\d.]+),([\d.]+)V([\d.]+)/g)];
  expect(runSegments.length).toBe(2);
  expect(walkSegments.length).toBe(1);
  const runSegment = runSegments[1];
  const walkSegment = walkSegments[0];
  if (!runSegment || !walkSegment) throw new Error("Missing stacked activity bin");
  expect(Number(walkSegment[1])).toBe(Number(runSegment[1]));
  expect(Number(walkSegment[2])).toBeCloseTo(Number(runSegment[3]), 8);
  expect(Number(walkSegment[2]) - Number(walkSegment[3])).toBeCloseTo(3, 8);
  expect(Number(walkSegment[3])).toBeGreaterThanOrEqual(28);
});


test("selected activity markers use exact values above the brush and update with selection", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  async function show(selectedValue: number | null) {
    await act(async () => root?.render(<Histogram title="Distance" bins={[]} binEnd={value => value + 1} domain={[0, 10]} range={[2, 4]} onRange={() => {}} format={String} selectedValue={selectedValue}/>));
  }
  await show(3.25);
  const marker = container.querySelector(".histogram__selected-value");
  expect(marker?.getAttribute("pointer-events")).toBe("none");
  expect(marker?.previousElementSibling?.classList.contains("histogram__brush")).toBe(true);
  expect(Number(marker?.querySelector("line")?.getAttribute("x1"))).toBeCloseTo(560 * 0.325);
  expect(marker?.querySelector("line")?.getAttribute("stroke")).toBe("#1769ed");
  await show(7.125);
  expect(Number(container.querySelector(".histogram__selected-value line")?.getAttribute("x1"))).toBeCloseTo(560 * 0.7125);
  await show(12);
  expect(container.querySelector(".histogram__selected-value")?.getAttribute("aria-label")).toContain("outside chart range");
  expect(container.querySelector(".histogram__selected-value text")?.textContent).toBe("12 →");
  await show(null);
  expect(container.querySelector(".histogram__selected-value")).toBeNull();
});
