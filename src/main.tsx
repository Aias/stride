import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { datasetSchema } from "./data";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<main className="loading-screen"><h1>Loading activities.</h1><p>Loading the local workout index…</p></main>);
  fetch("/data/runs.json")
    .then(async response => {
      if (!response.ok) throw new Error("The workout dataset is missing. Import your Apple Health export, then reload.");
      return datasetSchema.parse(await response.json());
    })
    .then(dataset => root.render(<StrictMode><App dataset={dataset} /></StrictMode>))
    .catch((error: unknown) => root.render(<main className="loading-screen"><h1>Your activities could not be opened.</h1><p>{error instanceof Error ? error.message : "The local dataset could not be read."}</p><button onClick={() => window.location.reload()}>Try again</button></main>));
}
