import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Trace } from "../src/RunDetail";

test("isolated heart-rate samples remain visible across recording gaps", () => {
  const markup = renderToStaticMarkup(<Trace label="Heart rate" unit="bpm" values={[
    { minute: 1, value: 120, segment: 0 },
    { minute: 20, value: 130, segment: 1 },
  ]}/>);
  expect(markup.match(/<circle/g)?.length).toBe(2);
  expect(markup).not.toContain("<path");
});

test("continuous samples draw a trace and missing samples have an explicit empty state", () => {
  const markup = renderToStaticMarkup(<Trace label="Heart rate" unit="bpm" values={[
    { minute: 1, value: 120, segment: 0 },
    { minute: 2, value: 130, segment: 0 },
  ]}/>);
  expect(markup.match(/<path/g)?.length).toBe(1);
  expect(renderToStaticMarkup(<Trace label="Heart rate" unit="bpm" values={[]}/>)).toContain("No samples recorded for this workout.");
});
