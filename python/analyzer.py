"""Resident, bounded JSON-lines adapter for the bundled FOA PowerMap skill."""
import argparse
import base64
import json
import sys
import time

import numpy as np
import foa_music_powermap as skill


class StreamingAnalyzer:
    def __init__(self):
        directions = skill.icosphere_directions(skill.DEFAULT_SCAN_FREQUENCY)
        self.steering = skill.first_order_steering(directions)
        grid = skill._equirectangular_grid(140, 70)
        self.indices, self.weights = skill._interpolation_lookup(directions, grid)
        self.previous = np.zeros(len(directions), np.float64)

    def reset(self):
        self.previous.fill(0)

    def analyze(self, chunk, order='WYZX'):
        chunk = np.asarray(chunk, dtype=np.float32)
        if chunk.shape != (1024, 4) or not np.all(np.isfinite(chunk)):
            raise ValueError('Expected finite 1024x4 FOA samples')
        if order not in ('WYZX', 'WXYZ'):
            raise ValueError('Unknown channel order')
        if order == 'WXYZ':
            chunk = chunk[:, [0, 2, 3, 1]]
        chunk = np.ascontiguousarray(chunk)
        covariance = np.sum(skill.stft_covariances(skill.ambix_sn3d_to_n3d(chunk)), axis=0)
        if float(np.trace(covariance).real) <= 1e-12:
            # Clear silence rather than normalizing an indefinitely decaying old peak.
            self.reset()
            return np.zeros((70, 140), np.float32)
        spectrum = skill.music_spectrum(covariance, self.steering, num_sources=1)
        self.previous = (1 - skill.DEFAULT_MAP_AVERAGE) * spectrum + skill.DEFAULT_MAP_AVERAGE * self.previous
        interpolated = np.sum(self.previous[self.indices] * self.weights, axis=1).reshape(70, 140)
        return skill._normalize_map(interpolated)

    @staticmethod
    def rgba(values):
        # Skill display coordinates put positive azimuth (left) on screen left.
        rgb, alpha = skill.render_map_frame(values, 140, 70, draw_grid=False)
        return np.dstack((rgb, np.round(alpha * 255).astype(np.uint8)))


def emit(value):
    print(json.dumps(value, allow_nan=False, separators=(',', ':')), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pcm')
    parser.add_argument('sample_rate', type=int)
    parser.add_argument('order', choices=['WYZX', 'WXYZ'])
    args = parser.parse_args()
    if args.sample_rate <= 0:
        raise ValueError('Invalid sample rate')
    samples = np.memmap(args.pcm, dtype='<f4', mode='r').reshape(-1, 4)
    engine = StreamingAnalyzer()
    generation = None
    previous_time = None
    emit({'type': 'ready'})
    for line in sys.stdin:
        request = {}
        try:
            if len(line) > 4096:
                raise ValueError('Oversized request')
            request = json.loads(line)
            timestamp = request['time']
            if not isinstance(timestamp, (int, float)) or not np.isfinite(timestamp) or timestamp < 0:
                raise ValueError('Invalid timestamp')
            if request['generation'] != generation or previous_time is None or timestamp < previous_time or timestamp - previous_time > .5:
                engine.reset()
            generation = request['generation']
            previous_time = timestamp
            start = round(timestamp * args.sample_rate)
            chunk = np.zeros((1024, 4), np.float32)
            available = samples[start:start + 1024]
            chunk[:len(available)] = available
            began = time.perf_counter()
            rgba = engine.rgba(engine.analyze(chunk, args.order))
            emit({'type': 'map', 'id': request['id'], 'generation': generation,
                  'time': timestamp, 'computeMs': (time.perf_counter() - began) * 1000,
                  'rgba': base64.b64encode(rgba.tobytes()).decode('ascii')})
        except Exception as error:
            emit({'type': 'error', 'id': request.get('id'), 'message': str(error)})


if __name__ == '__main__':
    main()
