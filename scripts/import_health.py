#!/usr/bin/env python3

import argparse
import bisect
import hashlib
import json
import math
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import DefaultDict, Dict, List, Literal, Optional, Sequence, Set, Tuple, TypedDict


ActivityType = Literal["run", "walk"]
ACTIVITY_TYPES: Dict[str, ActivityType] = {
    "HKWorkoutActivityTypeRunning": "run",
    "HKWorkoutActivityTypeWalking": "walk",
}


class RoutePoint(TypedDict):
    lat: float
    lon: float
    elevation: Optional[float]
    time: str
    segment: int


class HeartRatePoint(TypedDict):
    time: str
    bpm: float


class RunDetail(TypedDict):
    route: List[RoutePoint]
    heartRate: List[HeartRatePoint]


class HeartRateAssociation(TypedDict):
    interval: str
    exactSourceRuns: int
    runsWithoutSamples: int
    sampleReuse: str
    rejectedSamples: int


class Metadata(TypedDict):
    exportedAt: str
    runCount: int
    walkCount: int
    routesCount: int
    heartRateRunCount: int
    heartRateAssociation: HeartRateAssociation


class RunSummary(TypedDict):
    id: str
    activityType: ActivityType
    start: str
    end: str
    durationSeconds: float
    distanceMeters: Optional[float]
    elevationGainMeters: Optional[float]
    averageHeartRate: Optional[float]
    maxHeartRate: Optional[float]
    indoor: Optional[bool]
    source: str
    routePreview: List[RoutePoint]
    routePointCount: int
    heartRateCount: int
    detailPath: str


class RunIndex(TypedDict):
    runs: List[RunSummary]
    metadata: Metadata


@dataclass(frozen=True, order=True)
class HeartRateSample:
    timestamp: float
    time: str
    bpm: float
    sequence: int


@dataclass(frozen=True)
class HeartRateSeries:
    samples: List[HeartRateSample]
    timestamps: List[float]


@dataclass(frozen=True)
class Workout:
    activity_type: ActivityType
    start_raw: str
    end_raw: str
    duration_seconds: float
    distance_meters: Optional[float]
    elevation_gain_meters: Optional[float]
    average_heart_rate: Optional[float]
    max_heart_rate: Optional[float]
    indoor: Optional[bool]
    source: str
    route_references: List[str]


@dataclass(frozen=True)
class ParsedExport:
    exported_at: str
    workouts: List[Workout]
    source_samples: Dict[str, HeartRateSeries]
    rejected_samples: int


def parse_date(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S %z")


def iso_date(value: str) -> str:
    return parse_date(value).isoformat()


def finite_number(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def positive_number(value: Optional[str]) -> Optional[float]:
    number = finite_number(value)
    return number if number is not None and number > 0 else None


def duration_seconds(value: str, unit: str) -> float:
    factors = {"s": 1.0, "sec": 1.0, "min": 60.0, "hr": 3600.0}
    factor = factors.get(unit)
    if factor is None:
        raise ValueError(f"Unsupported workout duration unit: {unit}")
    result = float(value) * factor
    if not math.isfinite(result) or result < 0:
        raise ValueError(f"Invalid workout duration: {value} {unit}")
    return result


def distance_meters(value: Optional[str], unit: Optional[str]) -> Optional[float]:
    if value is None or unit is None:
        return None
    factors = {"m": 1.0, "km": 1000.0, "mi": 1609.344, "ft": 0.3048}
    factor = factors.get(unit)
    if factor is None:
        raise ValueError(f"Unsupported workout distance unit: {unit}")
    result = float(value) * factor
    return result if math.isfinite(result) and result >= 0 else None


def elevation_gain_meters(values: Sequence[str]) -> Optional[float]:
    converted: Set[float] = set()
    factors = {"cm": 0.01, "m": 1.0, "ft": 0.3048}
    for value in values:
        parts = value.split()
        if len(parts) != 2 or parts[1] not in factors:
            raise ValueError(f"Unsupported elevation gain: {value}")
        number = float(parts[0]) * factors[parts[1]]
        if not math.isfinite(number) or number < 0:
            return None
        converted.add(number)
    return next(iter(converted)) if len(converted) == 1 else None


def require_heart_rate_unit(unit: Optional[str]) -> None:
    if unit != "count/min":
        raise ValueError(f"Unsupported heart-rate unit: {unit}")


def workout_id(activity_type: ActivityType, start: str, end: str, source: str) -> str:
    digest = hashlib.sha256(f"{start}\0{end}\0{source}".encode()).hexdigest()[:16]
    return f"{activity_type}-{digest}"


def read_route_reference(archive: zipfile.ZipFile, reference: str, segment_offset: int) -> Tuple[List[RoutePoint], int]:
    route: List[RoutePoint] = []
    segment = -1
    stack: List[ET.Element] = []
    with archive.open(f"apple_health_export{reference}") as source:
        for event, element in ET.iterparse(source, events=("start", "end")):
            tag = element.tag.rsplit("}", 1)[-1]
            if event == "start":
                stack.append(element)
                if tag == "trkseg":
                    segment += 1
                continue
            if tag == "trkpt":
                latitude = finite_number(element.get("lat"))
                longitude = finite_number(element.get("lon"))
                time_element = next((child for child in element if child.tag.rsplit("}", 1)[-1] == "time"), None)
                elevation_element = next((child for child in element if child.tag.rsplit("}", 1)[-1] == "ele"), None)
                if latitude is not None and longitude is not None and time_element is not None and time_element.text:
                    route.append({
                        "lat": latitude,
                        "lon": longitude,
                        "elevation": finite_number(elevation_element.text if elevation_element is not None else None),
                        "time": datetime.fromisoformat(time_element.text.replace("Z", "+00:00")).isoformat(),
                        "segment": segment_offset + segment,
                    })
                if len(stack) > 1:
                    stack[-2].remove(element)
            stack.pop()
    return route, max(segment + 1, 0)


def read_routes(archive: zipfile.ZipFile, references: Sequence[str]) -> List[RoutePoint]:
    route: List[RoutePoint] = []
    segment_offset = 0
    for reference in references:
        points, segment_count = read_route_reference(archive, reference, segment_offset)
        route.extend(points)
        segment_offset += segment_count
    return route


def route_preview(route: Sequence[RoutePoint], limit: int = 200) -> List[RoutePoint]:
    if len(route) <= limit:
        return list(route)
    indexes = {round(index * (len(route) - 1) / (limit - 1)) for index in range(limit)}
    for index in range(1, len(route)):
        if route[index]["segment"] != route[index - 1]["segment"]:
            indexes.add(index - 1)
            indexes.add(index)
    return [point for index, point in enumerate(route) if index in indexes]


def heart_rate_series(samples: List[HeartRateSample]) -> HeartRateSeries:
    ordered = sorted(samples)
    return HeartRateSeries(ordered, [sample.timestamp for sample in ordered])


def samples_between(series: HeartRateSeries, start: float, end: float, used: Set[int]) -> List[HeartRateSample]:
    left = bisect.bisect_left(series.timestamps, start)
    right = bisect.bisect_left(series.timestamps, end)
    selected = [sample for sample in series.samples[left:right] if sample.sequence not in used]
    used.update(sample.sequence for sample in selected)
    return selected


def workout_from_element(element: ET.Element, activity_type: ActivityType) -> Workout:
    attributes = element.attrib
    statistics = {child.get("type"): child.attrib for child in element if child.tag == "WorkoutStatistics"}
    distance_stat = statistics.get("HKQuantityTypeIdentifierDistanceWalkingRunning")
    heart_rate_stat = statistics.get("HKQuantityTypeIdentifierHeartRate")
    if heart_rate_stat is not None:
        require_heart_rate_unit(heart_rate_stat.get("unit"))
    indoor_values = {child.get("value") for child in element if child.tag == "MetadataEntry" and child.get("key") == "HKIndoorWorkout"}
    elevation_values = [
        value
        for child in element
        if child.tag == "MetadataEntry" and child.get("key") == "HKElevationAscended"
        for value in [child.get("value")]
        if value is not None
    ]
    route_references = [
        path
        for child in element
        if child.tag == "WorkoutRoute"
        for reference in child.iter("FileReference")
        for path in [reference.get("path")]
        if path is not None
    ]
    return Workout(
        activity_type=activity_type,
        start_raw=attributes["startDate"],
        end_raw=attributes["endDate"],
        duration_seconds=duration_seconds(attributes["duration"], attributes["durationUnit"]),
        distance_meters=distance_meters(distance_stat.get("sum"), distance_stat.get("unit")) if distance_stat else None,
        elevation_gain_meters=elevation_gain_meters(elevation_values),
        average_heart_rate=positive_number(heart_rate_stat.get("average")) if heart_rate_stat else None,
        max_heart_rate=positive_number(heart_rate_stat.get("maximum")) if heart_rate_stat else None,
        indoor=next(iter(indoor_values)) == "1" if len(indoor_values) == 1 else None,
        source=attributes["sourceName"],
        route_references=route_references,
    )


def parse_export(archive: zipfile.ZipFile) -> ParsedExport:
    exported_at = ""
    samples_by_source: DefaultDict[str, List[HeartRateSample]] = defaultdict(list)
    workouts: List[Workout] = []
    rejected_samples = 0
    sequence = 0
    with archive.open("apple_health_export/export.xml") as source:
        root: Optional[ET.Element] = None
        depth = 0
        for event, element in ET.iterparse(source, events=("start", "end")):
            if event == "start":
                depth += 1
                if root is None:
                    root = element
                continue
            if depth == 2:
                if element.tag == "ExportDate":
                    exported_at = iso_date(element.attrib["value"])
                elif element.tag == "Record" and element.get("type") == "HKQuantityTypeIdentifierHeartRate":
                    require_heart_rate_unit(element.get("unit"))
                    value = positive_number(element.get("value"))
                    if value is None:
                        rejected_samples += 1
                    else:
                        timestamp_text = element.attrib["startDate"]
                        samples_by_source[element.attrib["sourceName"]].append(
                            HeartRateSample(parse_date(timestamp_text).timestamp(), iso_date(timestamp_text), value, sequence)
                        )
                        sequence += 1
                elif element.tag == "Workout":
                    activity_type = ACTIVITY_TYPES.get(element.attrib["workoutActivityType"])
                    if activity_type is not None:
                        workouts.append(workout_from_element(element, activity_type))
                if root is not None:
                    root.remove(element)
            depth -= 1
    return ParsedExport(
        exported_at,
        workouts,
        {source_name: heart_rate_series(samples) for source_name, samples in samples_by_source.items()},
        rejected_samples,
    )


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")


def build_summary(workout: Workout, route: List[RoutePoint], heart_rate: List[HeartRatePoint], identifier: str) -> RunSummary:
    return {
        "id": identifier,
        "activityType": workout.activity_type,
        "start": iso_date(workout.start_raw),
        "end": iso_date(workout.end_raw),
        "durationSeconds": workout.duration_seconds,
        "distanceMeters": workout.distance_meters,
        "elevationGainMeters": workout.elevation_gain_meters,
        "averageHeartRate": workout.average_heart_rate,
        "maxHeartRate": workout.max_heart_rate,
        "indoor": workout.indoor,
        "source": workout.source,
        "routePreview": route_preview(route),
        "routePointCount": len(route),
        "heartRateCount": len(heart_rate),
        "detailPath": f"/data/runs/{identifier}.json",
    }


def import_health(zip_path: Path, output_dir: Path) -> None:
    detail_dir = output_dir / "runs"
    detail_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        parsed = parse_export(archive)
        used_samples: Set[int] = set()
        summaries: List[RunSummary] = []
        heart_rate_runs = 0
        routes_count = 0
        for workout in sorted(parsed.workouts, key=lambda item: item.start_raw):
            selected_samples = samples_between(
                parsed.source_samples.get(workout.source, HeartRateSeries([], [])),
                parse_date(workout.start_raw).timestamp(),
                parse_date(workout.end_raw).timestamp(),
                used_samples,
            )
            heart_rate_runs += bool(selected_samples)
            identifier = workout_id(workout.activity_type, workout.start_raw, workout.end_raw, workout.source)
            route = read_routes(archive, workout.route_references)
            routes_count += bool(route)
            heart_rate: List[HeartRatePoint] = [{"time": sample.time, "bpm": sample.bpm} for sample in selected_samples]
            detail: RunDetail = {"route": route, "heartRate": heart_rate}
            write_json(detail_dir / f"{identifier}.json", detail)
            summaries.append(build_summary(workout, route, heart_rate, identifier))
        association: HeartRateAssociation = {
            "interval": "half-open [start,end)",
            "exactSourceRuns": heart_rate_runs,
            "runsWithoutSamples": len(summaries) - heart_rate_runs,
            "sampleReuse": "first chronological workout only",
            "rejectedSamples": parsed.rejected_samples,
        }
        metadata: Metadata = {
            "exportedAt": parsed.exported_at,
            "runCount": sum(summary["activityType"] == "run" for summary in summaries),
            "walkCount": sum(summary["activityType"] == "walk" for summary in summaries),
            "routesCount": routes_count,
            "heartRateRunCount": heart_rate_runs,
            "heartRateAssociation": association,
        }
        index: RunIndex = {"runs": summaries, "metadata": metadata}
        write_json(output_dir / "runs.json", index)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("zip_path", type=Path)
    parser.add_argument("output_dir", nargs="?", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "data")
    arguments = parser.parse_args()
    import_health(arguments.zip_path, arguments.output_dir)


if __name__ == "__main__":
    main()
