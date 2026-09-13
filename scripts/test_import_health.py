import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from import_health import HeartRateSample, distance_meters, duration_seconds, elevation_gain_meters, heart_rate_series, import_health, route_preview, samples_between


class ImportHealthTest(unittest.TestCase):
    def test_units(self) -> None:
        self.assertEqual(duration_seconds("2.5", "min"), 150)
        self.assertAlmostEqual(distance_meters("1", "mi") or 0, 1609.344)
        with self.assertRaises(ValueError):
            duration_seconds("2", "days")
        with self.assertRaises(ValueError):
            distance_meters("2", "yards")

    def test_recorded_elevation_gain_normalizes_duplicate_metadata(self) -> None:
        self.assertEqual(elevation_gain_meters(["1234 cm", "12.34 m"]), 12.34)
        self.assertEqual(elevation_gain_meters(["0 cm", "0 cm"]), 0)
        self.assertIsNone(elevation_gain_meters([]))
        self.assertIsNone(elevation_gain_meters(["10 m", "11 m"]))

    def test_route_preview_keeps_segment_boundaries(self) -> None:
        route = [
            {"lat": float(index), "lon": 0.0, "elevation": None, "time": str(index), "segment": index // 3}
            for index in range(9)
        ]
        preview = route_preview(route, 3)
        included = {(point["segment"], point["lat"]) for point in preview}
        self.assertTrue({(0, 2.0), (1, 3.0), (1, 5.0), (2, 6.0)}.issubset(included))
        self.assertGreater(len(preview), 3)

    def test_source_only_half_open_matching(self) -> None:
        series = heart_rate_series([
            HeartRateSample(10, "start", 120, 0),
            HeartRateSample(19, "inside", 130, 1),
            HeartRateSample(20, "end", 140, 2),
        ])
        used = set()
        self.assertEqual([sample.bpm for sample in samples_between(series, 10, 20, used)], [120, 130])
        self.assertEqual(samples_between(series, 10, 20, used), [])

    def test_mini_export_uses_exact_source_and_all_routes(self) -> None:
        xml = """<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_US">
<ExportDate value="2026-01-03 10:00:00 -0500"/>
<Record type="HKQuantityTypeIdentifierHeartRate" unit="count/min" value="140" sourceName="Watch A" startDate="2026-01-02 09:01:00 -0500" endDate="2026-01-02 09:01:00 -0500"/>
<Record type="HKQuantityTypeIdentifierHeartRate" unit="count/min" value="180" sourceName="Watch B" startDate="2026-01-02 09:01:00 -0500" endDate="2026-01-02 09:01:00 -0500"/>
<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="10" durationUnit="min" sourceName="Watch A" startDate="2026-01-02 09:00:00 -0500" endDate="2026-01-02 09:10:00 -0500">
<WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="2026-01-02 09:00:00 -0500" endDate="2026-01-02 09:10:00 -0500" sum="1" unit="mi"/>
<MetadataEntry key="HKElevationAscended" value="1234 cm"/>
<MetadataEntry key="HKElevationAscended" value="1234 cm"/>
<WorkoutRoute><FileReference path="/workout-routes/a.gpx"/></WorkoutRoute>
<WorkoutRoute><FileReference path="/workout-routes/b.gpx"/></WorkoutRoute>
</Workout>
</HealthData>"""
        gpx = """<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="1" lon="2"><time>2026-01-02T14:01:00Z</time></trkpt></trkseg></trk></gpx>"""
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "export.zip"
            output_path = Path(directory) / "data"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("apple_health_export/export.xml", xml)
                archive.writestr("apple_health_export/workout-routes/a.gpx", gpx)
                archive.writestr("apple_health_export/workout-routes/b.gpx", gpx)
            import_health(archive_path, output_path)
            index = json.loads((output_path / "runs.json").read_text())
            summary = index["runs"][0]
            detail = json.loads((output_path / "runs" / f"{summary['id']}.json").read_text())
            self.assertEqual(index["metadata"]["heartRateRunCount"], 1)
            self.assertEqual(summary["activityType"], "run")
            self.assertEqual(summary["elevationGainMeters"], 12.34)
            self.assertEqual(detail["heartRate"], [{"time": "2026-01-02T09:01:00-05:00", "bpm": 140.0}])
            self.assertEqual([point["segment"] for point in detail["route"]], [0, 1])

    def test_imports_runs_and_walks_with_distinct_identifiers(self) -> None:
        workouts = "".join(
            f'<Workout workoutActivityType="HKWorkoutActivityType{activity}" duration="10" durationUnit="min" sourceName="Watch A" startDate="2026-01-02 09:00:00 -0500" endDate="2026-01-02 09:10:00 -0500">'
            '<WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="1" unit="km"/>'
            '</Workout>'
            for activity in ["Running", "Walking", "Swimming"]
        )
        xml = f'<HealthData><ExportDate value="2026-01-03 10:00:00 -0500"/>{workouts}</HealthData>'
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "export.zip"
            output_path = Path(directory) / "data"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("apple_health_export/export.xml", xml)
            import_health(archive_path, output_path)
            index = json.loads((output_path / "runs.json").read_text())
            self.assertEqual(index["metadata"]["runCount"], 1)
            self.assertEqual(index["metadata"]["walkCount"], 1)
            self.assertEqual([summary["activityType"] for summary in index["runs"]], ["run", "walk"])
            self.assertEqual(len({summary["id"] for summary in index["runs"]}), 2)
            for summary in index["runs"]:
                self.assertTrue(summary["id"].startswith(f"{summary['activityType']}-"))
                self.assertEqual(summary["distanceMeters"], 1000)
                self.assertTrue((output_path / "runs" / f"{summary['id']}.json").exists())


if __name__ == "__main__":
    unittest.main()
