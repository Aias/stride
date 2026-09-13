# Stride

A local running and walking dashboard built with React, D3, and the published `@aias/crossfilter` package. Date, distance, pace, heart-rate, and elevation-gain chart filters coordinate the charts, route map, and activity log. Select a workout to read its heart-rate and elevation traces.

<img width="1082" height="967" alt="image" src="https://github.com/user-attachments/assets/8378ac8f-6f49-4f27-b88f-a946ce6c38c1" />

Install dependencies with `bun install --frozen-lockfile`. Start the app from this directory:

```sh
pm2 start "bun run dev" --name stride --time
```

Open http://127.0.0.1:4173. Read server logs with `pm2 logs stride --nostream --lines 30`. Stop the app with `pm2 delete stride`.

## Import Apple Health data

```sh
bun run import /path/to/export.zip
```

The importer reads the archive directly and extracts running and walking workouts into `public/data`. It keeps GPS previews in the summary index and full traces in separate files. Refresh the dashboard after importing another export.

The dashboard includes personal workout data in both `public/data` and production builds. Those directories are excluded from Git. The server binds to localhost. MapLibre renders local route geometry over the OpenFreeMap Positron basemap. The map opens around a recent workout, supports street-level zoom and pan, and keeps its camera steady during chart filtering. Fit routes shows all filtered routes; Focus selected frames the selected workout. Basemap tiles, fonts, and styles load from OpenFreeMap, whose servers receive requests for viewed map areas. Workout records and GPS tracks stay local. Map data attribution remains visible in the map controls.

## Reading the charts

Bars stack green runs and warm orange walks. Routes and activity labels use the same colors. The All / Runs / Walks toggle filters every view through Crossfilter.

Drag across a distribution to select a range. Each histogram shows workouts that match the other filters, so its own distribution remains available for adjusting the selection. Drag the selected region to move it or either edge to resize it. Selection edges snap to bin boundaries: months, miles, 30-second pace intervals, five-bpm heart-rate intervals, and 50-foot elevation-gain intervals. Moving a selection preserves its number of bins. All views update during dragging. Focus a chart and use the arrow keys to move its selection, Shift and arrow keys to resize its end, or Escape to clear it. Nonempty activity segments have a minimum height of three pixels. Hover a bin for its exact count.

Distance is shown in miles. Pace is recorded workout duration divided by distance. Workouts with missing distance have no pace. The pace chart groups values at 40 minutes per mile and above in its rightmost bar. Workout details and the table retain the full recorded pace.

Heart-rate filters use the workout's recorded average. The dashboard's average heart rate is the arithmetic mean of the selected workout averages. Missing averages remain missing. Individual heart-rate samples are associated by matching recording source and workout time, with an inclusive start and exclusive end. A sample belongs to at most one workout. Gaps longer than two minutes break the heart-rate trace.

Dates preserve the local calendar date in the export. Chart traces use elapsed time from the workout start, including pauses. GPS track segments remain separate. Elevation traces show recorded altitude in feet. The elevation-gain histogram uses Apple’s recorded total ascent, converted to feet. Workouts without a recorded ascent remain visible until an elevation-gain filter is applied.

## Checks

Import an Apple Health archive before running the data-backed tests.

```sh
bun run typecheck
bun run lint
bun test
python3 -m unittest discover -s scripts -p 'test_*.py'
bun run build
```

The Crossfilter tests compare coordinated selections against the imported running and walking archive. The importer tests cover normalization, source matching, interval boundaries, and segmented GPS previews.
