# SPDX-License-Identifier: MIT
"""Generate equirectangular Power Maps from first-order Ambisonic audio."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial import cKDTree


DEFAULT_FRAME_SIZE = 1024
DEFAULT_STFT_SIZE = 256
DEFAULT_STFT_HOP_SIZE = 128
DEFAULT_MAP_INTERVAL_SECONDS = 0.14
DEFAULT_MAP_AVERAGE = 0.666
DEFAULT_GRID_WIDTH = 140
DEFAULT_GRID_HEIGHT = 70
DEFAULT_SCAN_FREQUENCY = 9

POWERMAP_COLOUR_TABLE = np.array(
    [
        (61, 0, 209), (59, 7, 208), (56, 22, 208), (54, 29, 208),
        (51, 44, 207), (47, 58, 207), (44, 73, 207), (44, 75, 207),
        (43, 80, 207), (43, 82, 207), (41, 88, 206), (41, 90, 206),
        (40, 91, 206), (39, 95, 206), (39, 97, 206), (39, 99, 206),
        (38, 102, 206), (38, 104, 206), (37, 106, 206), (36, 110, 206),
        (36, 112, 206), (35, 114, 206), (34, 117, 206), (34, 119, 206),
        (34, 121, 206), (33, 125, 206), (33, 127, 206), (32, 127, 206),
        (32, 128, 206), (31, 132, 205), (31, 134, 205), (31, 135, 205),
        (30, 136, 205), (30, 138, 205), (30, 139, 205), (30, 141, 205),
        (29, 143, 205), (29, 145, 205), (28, 147, 205), (27, 150, 205),
        (26, 154, 205), (26, 156, 205), (26, 158, 205), (25, 161, 205),
        (24, 165, 205), (24, 167, 205), (23, 169, 205), (22, 172, 205),
        (21, 176, 204), (21, 180, 204), (20, 183, 204), (19, 187, 204),
        (18, 191, 204), (17, 194, 204), (17, 198, 204), (16, 202, 213),
        (15, 205, 204), (14, 209, 204), (13, 213, 204), (13, 217, 204),
        (16, 217, 189), (19, 217, 176), (23, 218, 162), (26, 218, 150),
        (30, 218, 137), (33, 219, 125), (37, 219, 114), (41, 220, 103),
        (44, 220, 93), (48, 221, 83), (51, 221, 73), (55, 222, 64),
        (61, 222, 59), (77, 222, 62), (106, 223, 69), (120, 224, 73),
        (133, 224, 77), (147, 225, 81), (152, 222, 77), (158, 220, 73),
        (163, 218, 69), (175, 213, 65), (180, 211, 57), (186, 208, 53),
        (192, 206, 49), (197, 204, 45), (203, 201, 41), (208, 199, 37),
        (214, 197, 33), (220, 194, 29), (225, 192, 25), (231, 190, 21),
        (237, 187, 17), (242, 185, 13), (248, 183, 9), (254, 181, 6),
        (254, 184, 5), (254, 188, 5), (254, 192, 5), (254, 196, 5),
        (254, 200, 5), (254, 204, 5), (254, 208, 5), (254, 212, 5),
        (254, 216, 5), (254, 220, 5), (254, 224, 5), (254, 228, 5),
        (254, 236, 5), (254, 240, 5), (254, 244, 5), (254, 248, 5),
        (254, 252, 5), (253, 255, 5),
    ],
    dtype=np.uint8,
)


@dataclass(frozen=True)
class PowerMapResult:
    maps: np.ndarray
    timestamps: np.ndarray
    scan_directions_degrees: np.ndarray
    grid_directions_degrees: np.ndarray
    config: dict[str, object]
    duration: float


def ambix_sn3d_to_n3d(audio: np.ndarray) -> np.ndarray:
    """Convert sample-major first-order AmbiX from SN3D to N3D."""
    values = np.asarray(audio)
    if values.ndim != 2 or values.shape[1] != 4:
        channels = values.shape[1] if values.ndim == 2 else "unknown"
        raise ValueError(f"Expected four FOA channels (W/Y/Z/X), got {channels}")
    converted = values.astype(np.float32, copy=True)
    converted[:, 1:] *= np.float32(math.sqrt(3.0))
    return converted


def _icosahedron() -> tuple[np.ndarray, np.ndarray]:
    golden_ratio = (1.0 + math.sqrt(5.0)) / 2.0
    vertices = np.array(
        [
            (-1, golden_ratio, 0),
            (1, golden_ratio, 0),
            (-1, -golden_ratio, 0),
            (1, -golden_ratio, 0),
            (0, -1, golden_ratio),
            (0, 1, golden_ratio),
            (0, -1, -golden_ratio),
            (0, 1, -golden_ratio),
            (golden_ratio, 0, -1),
            (golden_ratio, 0, 1),
            (-golden_ratio, 0, -1),
            (-golden_ratio, 0, 1),
        ],
        dtype=np.float64,
    )
    vertices /= np.linalg.norm(vertices, axis=1, keepdims=True)
    faces = np.array(
        [
            (0, 11, 5),
            (0, 5, 1),
            (0, 1, 7),
            (0, 7, 10),
            (0, 10, 11),
            (1, 5, 9),
            (5, 11, 4),
            (11, 10, 2),
            (10, 7, 6),
            (7, 1, 8),
            (3, 9, 4),
            (3, 4, 2),
            (3, 2, 6),
            (3, 6, 8),
            (3, 8, 9),
            (4, 9, 5),
            (2, 4, 11),
            (6, 2, 10),
            (8, 6, 7),
            (9, 8, 1),
        ],
        dtype=np.int32,
    )
    return vertices, faces


def _directions_to_cartesian(directions_degrees: np.ndarray) -> np.ndarray:
    directions = np.asarray(directions_degrees, dtype=np.float64)
    if directions.ndim != 2 or directions.shape[1] != 2:
        raise ValueError("Directions must have shape [N, 2] as azimuth/elevation")
    azimuth = np.radians(directions[:, 0])
    elevation = np.radians(directions[:, 1])
    cos_elevation = np.cos(elevation)
    return np.column_stack(
        (
            cos_elevation * np.cos(azimuth),
            cos_elevation * np.sin(azimuth),
            np.sin(elevation),
        )
    )


def icosphere_directions(frequency: int = DEFAULT_SCAN_FREQUENCY) -> np.ndarray:
    """Return an icosphere scan grid as azimuth/elevation degrees."""
    if frequency < 1:
        raise ValueError("Icosphere frequency must be positive")
    vertices, faces = _icosahedron()
    unique_points: dict[tuple[float, float, float], np.ndarray] = {}
    for face in faces:
        a, b, c = vertices[face]
        for i in range(frequency + 1):
            for j in range(frequency + 1 - i):
                k = frequency - i - j
                point = (i * a + j * b + k * c) / frequency
                point /= np.linalg.norm(point)
                unique_points[tuple(np.round(point, 12))] = point

    points = np.array(list(unique_points.values()), dtype=np.float64)
    azimuth = np.degrees(np.arctan2(points[:, 1], points[:, 0]))
    azimuth = (azimuth + 180.0) % 360.0 - 180.0
    elevation = np.degrees(np.arcsin(np.clip(points[:, 2], -1.0, 1.0)))
    directions = np.column_stack((azimuth, elevation))
    order = np.lexsort((directions[:, 0], directions[:, 1]))
    return directions[order].astype(np.float32)


def first_order_steering(directions_degrees: np.ndarray) -> np.ndarray:
    """Return N3D real-SH steering vectors in ACN W/Y/Z/X order."""
    directions = np.asarray(directions_degrees, dtype=np.float64)
    if directions.ndim != 2 or directions.shape[1] != 2:
        raise ValueError("Directions must have shape [N, 2] as azimuth/elevation")
    azimuth = np.radians(directions[:, 0])
    elevation = np.radians(directions[:, 1])
    root_three = math.sqrt(3.0)
    return np.column_stack(
        (
            np.ones(len(directions)),
            root_three * np.cos(elevation) * np.sin(azimuth),
            root_three * np.sin(elevation),
            root_three * np.cos(elevation) * np.cos(azimuth),
        )
    ).astype(np.float64)


def validate_num_sources(num_sources: int) -> None:
    if num_sources not in (1, 2):
        raise ValueError("First-order MUSIC supports num_sources 1 or 2")


def music_spectrum(
    covariance: np.ndarray,
    steering_vectors: np.ndarray,
    num_sources: int = 1,
) -> np.ndarray:
    """Evaluate the MUSIC pseudo-spectrum over row-major steering vectors."""
    validate_num_sources(num_sources)
    covariance = np.asarray(covariance)
    steering_vectors = np.asarray(steering_vectors)
    if covariance.shape != (4, 4):
        raise ValueError("FOA covariance must have shape [4, 4]")
    if steering_vectors.ndim != 2 or steering_vectors.shape[1] != 4:
        raise ValueError("FOA steering vectors must have shape [N, 4]")

    _, eigenvectors = np.linalg.eigh(covariance)
    noise_subspace = eigenvectors[:, : 4 - num_sources]
    projection = np.einsum(
        "ij,kj->ik",
        noise_subspace.conj().T,
        steering_vectors,
        optimize=True,
    )
    denominator = np.sum(np.abs(projection) ** 2, axis=0).real
    return 1.0 / (denominator + 2.23e-10)


def stft_covariances(
    frame: np.ndarray,
    stft_size: int = DEFAULT_STFT_SIZE,
    hop_size: int = DEFAULT_STFT_HOP_SIZE,
) -> np.ndarray:
    """Return one complex spatial covariance matrix per STFT frequency bin."""
    values = np.asarray(frame, dtype=np.float32)
    if values.ndim != 2 or values.shape[1] != 4:
        raise ValueError("STFT input must have shape [samples, 4]")
    if stft_size <= 0 or hop_size <= 0 or hop_size > stft_size:
        raise ValueError("STFT sizes must satisfy 0 < hop_size <= stft_size")

    n_slots = max(1, math.ceil(len(values) / hop_size))
    required = (n_slots - 1) * hop_size + stft_size
    padded = np.pad(
        values,
        (
            (
                stft_size - hop_size,
                max(0, required - len(values) - stft_size + hop_size),
            ),
            (0, 0),
        ),
    )
    frames = np.stack(
        [
            padded[start : start + stft_size]
            for start in range(0, n_slots * hop_size, hop_size)
        ]
    )
    spectra = np.fft.rfft(
        frames * np.hanning(stft_size).astype(np.float32)[None, :, None],
        axis=1,
    )
    return np.einsum("tfc,tfd->fcd", spectra, spectra.conj(), optimize=True)


def _equirectangular_grid(width: int, height: int) -> np.ndarray:
    azimuth = -180.0 + np.arange(width, dtype=np.float64) * (360.0 / width)
    elevation = -90.0 + np.arange(height, dtype=np.float64) * (180.0 / height)
    azimuth_mesh, elevation_mesh = np.meshgrid(azimuth, elevation)
    return np.stack((azimuth_mesh, elevation_mesh), axis=-1).astype(np.float32)


def _interpolation_lookup(
    scan_directions_degrees: np.ndarray,
    grid_directions_degrees: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    scan_cartesian = _directions_to_cartesian(scan_directions_degrees)
    grid_cartesian = _directions_to_cartesian(grid_directions_degrees.reshape(-1, 2))
    tree = cKDTree(scan_cartesian)
    _, indices = tree.query(grid_cartesian, k=3)
    selected = scan_cartesian[indices]
    cosine = np.einsum("nki,ni->nk", selected, grid_cartesian)
    angular_distance = np.arccos(np.clip(cosine, -1.0, 1.0))
    weights = 1.0 / np.maximum(angular_distance, 1e-9)
    exact = angular_distance <= 1e-8
    exact_rows = np.any(exact, axis=1)
    weights[exact_rows] = exact[exact_rows].astype(np.float64)
    weights /= np.sum(weights, axis=1, keepdims=True)
    return indices.astype(np.int32), weights.astype(np.float32)


def _normalize_map(power_map: np.ndarray) -> np.ndarray:
    minimum = float(np.min(power_map))
    peak_to_peak = float(np.max(power_map) - minimum)
    if peak_to_peak <= 1e-12:
        return np.zeros_like(power_map, dtype=np.float32)
    return ((power_map - minimum) / peak_to_peak).astype(np.float32)


def analyze_foa(
    audio: np.ndarray,
    sample_rate: int,
    num_sources: int = 1,
    frame_size: int = DEFAULT_FRAME_SIZE,
    map_interval: float = DEFAULT_MAP_INTERVAL_SECONDS,
    map_average: float = DEFAULT_MAP_AVERAGE,
) -> PowerMapResult:
    """Analyze sample-major AmbiX FOA into normalized 140x70 MUSIC maps."""
    validate_num_sources(num_sources)
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")
    if frame_size <= 0:
        raise ValueError("frame_size must be positive")
    if map_interval <= 0.0:
        raise ValueError("map_interval must be positive")
    if not 0.0 <= map_average < 1.0:
        raise ValueError("map_average must be in [0, 1)")

    n3d_audio = ambix_sn3d_to_n3d(audio)
    duration = len(n3d_audio) / float(sample_rate)
    n_maps = max(1, math.ceil(duration / map_interval))
    timestamps = np.arange(n_maps, dtype=np.float64) * map_interval

    scan_directions = icosphere_directions(DEFAULT_SCAN_FREQUENCY)
    steering = first_order_steering(scan_directions)
    grid_directions = _equirectangular_grid(DEFAULT_GRID_WIDTH, DEFAULT_GRID_HEIGHT)
    interpolation_indices, interpolation_weights = _interpolation_lookup(
        scan_directions, grid_directions
    )

    maps = np.empty((n_maps, DEFAULT_GRID_HEIGHT, DEFAULT_GRID_WIDTH), dtype=np.float32)
    previous_spectrum = np.zeros(len(scan_directions), dtype=np.float64)

    for map_index, timestamp in enumerate(timestamps):
        start = round(float(timestamp) * sample_rate)
        chunk = np.zeros((frame_size, 4), dtype=np.float32)
        available = n3d_audio[start : start + frame_size]
        chunk[: len(available)] = available
        covariance = np.sum(stft_covariances(chunk), axis=0)

        if float(np.trace(covariance).real) <= 1e-12:
            spectrum = np.zeros(len(scan_directions), dtype=np.float64)
        else:
            spectrum = music_spectrum(covariance, steering, num_sources)
        spectrum = (1.0 - map_average) * spectrum + map_average * previous_spectrum
        previous_spectrum = spectrum

        interpolated = np.sum(
            spectrum[interpolation_indices] * interpolation_weights,
            axis=1,
        ).reshape(DEFAULT_GRID_HEIGHT, DEFAULT_GRID_WIDTH)
        maps[map_index] = _normalize_map(interpolated)

    config: dict[str, object] = {
        "renderer": "Time-frequency first-order FOA MUSIC Power Map",
        "method": "MUSIC",
        "analysis_domain": "time-frequency",
        "foa_format": "AmbiX ACN/SN3D (W/Y/Z/X)",
        "analysis_normalization": "N3D",
        "master_order": 1,
        "num_sources": num_sources,
        "frame_size_samples": frame_size,
        "stft_size_samples": DEFAULT_STFT_SIZE,
        "stft_hop_size_samples": DEFAULT_STFT_HOP_SIZE,
        "frequency_bins": DEFAULT_STFT_SIZE // 2 + 1,
        "covariance_average": 0.0,
        "powermap_average": map_average,
        "map_interval_seconds": map_interval,
        "scan_directions": len(scan_directions),
        "grid_width": DEFAULT_GRID_WIDTH,
        "grid_height": DEFAULT_GRID_HEIGHT,
        "horizontal_fov_degrees": 360,
        "aspect_ratio": "2:1",
        "sample_rate": sample_rate,
    }
    return PowerMapResult(
        maps=maps,
        timestamps=timestamps,
        scan_directions_degrees=scan_directions,
        grid_directions_degrees=grid_directions,
        config=config,
        duration=duration,
    )


def colourize_map(power_map: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Apply the logarithmic display curve and 114-entry RGB table."""
    values = np.asarray(power_map, dtype=np.float32)
    if values.ndim != 2:
        raise ValueError("power_map must be a two-dimensional array")
    if not np.all(np.isfinite(values)):
        raise ValueError("power_map contains non-finite values")
    clipped = np.clip(values, 0.0, 1.0)
    alpha = np.log2(1.0 + clipped).astype(np.float32)
    indices = np.minimum(
        (alpha * len(POWERMAP_COLOUR_TABLE)).astype(np.int32),
        len(POWERMAP_COLOUR_TABLE) - 1,
    )
    return POWERMAP_COLOUR_TABLE[indices], alpha


def draw_powermap_grid(frame: np.ndarray) -> np.ndarray:
    height, width = frame.shape[:2]
    minor = frame.copy()
    for index in range(9):
        x = min(round(index * width / 8.0), width - 1)
        cv2.line(minor, (x, 0), (x, height - 1), (255, 255, 255), 1, cv2.LINE_AA)
    for index in range(5):
        y = min(round(index * height / 4.0), height - 1)
        cv2.line(minor, (0, y), (width - 1, y), (255, 255, 255), 1, cv2.LINE_AA)
    frame = cv2.addWeighted(minor, 0.1, frame, 0.9, 0.0)

    major = frame.copy()
    cv2.line(major, (0, height // 2), (width - 1, height // 2), (255, 255, 255), 1, cv2.LINE_AA)
    cv2.line(major, (width // 2, 0), (width // 2, height - 1), (255, 255, 255), 1, cv2.LINE_AA)
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(0.3, min(width / 960.0, height / 480.0) * 0.45)
    thickness = max(1, round(font_scale * 2.0))
    for index, label in enumerate(("180", "135", "90", "45", "0", "-45", "-90", "-135", "-180")):
        x = min(round(index * width / 8.0), width - 1)
        text_size = cv2.getTextSize(label, font, font_scale, thickness)[0]
        text_x = max(1, min(x - text_size[0] // 2, width - text_size[0] - 1))
        text_y = min(height - 2, height // 2 + text_size[1] + 3)
        cv2.putText(major, label, (text_x, text_y), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
    for index, label in enumerate(("90", "45", "0", "-45", "-90")):
        y = min(round(index * height / 4.0), height - 1)
        text_size = cv2.getTextSize(label, font, font_scale, thickness)[0]
        text_x = min(width - text_size[0] - 2, width // 2 + 4)
        text_y = max(text_size[1] + 1, min(y - 3, height - 2))
        cv2.putText(major, label, (text_x, text_y), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
    return cv2.addWeighted(major, 0.75, frame, 0.25, 0.0)


def render_map_frame(
    power_map: np.ndarray,
    width: int,
    height: int,
    draw_grid: bool = True,
) -> tuple[np.ndarray, np.ndarray]:
    """Render one normalized map in an equirectangular orientation."""
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be positive")
    displayed = np.flip(np.asarray(power_map), axis=(0, 1))
    frame, alpha = colourize_map(displayed)
    if frame.shape[1] != width or frame.shape[0] != height:
        frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_LINEAR)
        alpha = cv2.resize(alpha, (width, height), interpolation=cv2.INTER_LINEAR)
    if draw_grid:
        frame = draw_powermap_grid(frame)
    return np.ascontiguousarray(frame), np.ascontiguousarray(alpha, dtype=np.float32)


def compose_overlay_frame(
    power_map: np.ndarray,
    background: np.ndarray,
    draw_grid: bool = True,
) -> np.ndarray:
    """Mix a Power Map over RGB video using energy-dependent opacity."""
    background = np.asarray(background)
    if background.ndim != 3 or background.shape[2] != 3:
        raise ValueError("background must be an RGB image with shape [H, W, 3]")
    height, width = background.shape[:2]
    map_frame, alpha = render_map_frame(
        power_map,
        width=width,
        height=height,
        draw_grid=False,
    )
    mixed = (
        map_frame.astype(np.float32) * alpha[..., None]
        + background.astype(np.float32) * (1.0 - alpha[..., None])
    )
    mixed = np.clip(np.rint(mixed), 0, 255).astype(np.uint8)
    if draw_grid:
        mixed = draw_powermap_grid(mixed)
    return np.ascontiguousarray(mixed)


def save_powermap(path: Path | str, result: PowerMapResult) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as output_file:
        np.savez_compressed(
            output_file,
            maps=np.asarray(result.maps, dtype=np.float32),
            timestamps=np.asarray(result.timestamps, dtype=np.float64),
            scan_directions_degrees=np.asarray(result.scan_directions_degrees, dtype=np.float32),
            grid_directions_degrees=np.asarray(result.grid_directions_degrees, dtype=np.float32),
            config_json=np.array(json.dumps(result.config, sort_keys=True, ensure_ascii=True)),
            duration=np.array(result.duration, dtype=np.float64),
        )


def load_powermap(path: Path | str) -> PowerMapResult:
    input_path = Path(path)
    try:
        with np.load(input_path, allow_pickle=False) as archive:
            required = {
                "maps",
                "timestamps",
                "scan_directions_degrees",
                "grid_directions_degrees",
                "config_json",
                "duration",
            }
            if not required.issubset(archive.files):
                raise ValueError("missing required fields")
            maps = np.asarray(archive["maps"], dtype=np.float32)
            timestamps = np.asarray(archive["timestamps"], dtype=np.float64)
            scan_directions = np.asarray(archive["scan_directions_degrees"], dtype=np.float32)
            grid_directions = np.asarray(archive["grid_directions_degrees"], dtype=np.float32)
            config = json.loads(str(archive["config_json"].item()))
            duration = float(archive["duration"].item())

        if maps.ndim != 3 or timestamps.shape != (len(maps),):
            raise ValueError("map/timestamp shape mismatch")
        if scan_directions.ndim != 2 or scan_directions.shape[1] != 2:
            raise ValueError("invalid scan directions")
        if grid_directions.shape != (*maps.shape[1:], 2):
            raise ValueError("grid/map shape mismatch")
        if not isinstance(config, dict):
            raise ValueError("configuration is not an object")
        if duration < 0.0 or not math.isfinite(duration):
            raise ValueError("invalid duration")
        if not all(
            np.all(np.isfinite(values))
            for values in (maps, timestamps, scan_directions, grid_directions)
        ):
            raise ValueError("sidecar contains non-finite values")
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError(f"Malformed Power Map sidecar {input_path}: {error}") from error

    return PowerMapResult(
        maps=maps,
        timestamps=timestamps,
        scan_directions_degrees=scan_directions,
        grid_directions_degrees=grid_directions,
        config=config,
        duration=duration,
    )
