import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from analyzer import StreamingAnalyzer
import foa_music_powermap as skill


class AnalyzerTests(unittest.TestCase):
    def test_matches_skill_with_history(self):
        rate = 48000
        audio = np.random.default_rng(3).normal(size=(18000, 4)).astype(np.float32)
        reference = skill.analyze_foa(audio, rate)
        engine = StreamingAnalyzer()
        for timestamp, expected in zip(reference.timestamps, reference.maps):
            start = round(timestamp * rate)
            chunk = np.zeros((1024, 4), np.float32)
            available = audio[start:start + 1024]
            chunk[:len(available)] = available
            np.testing.assert_allclose(engine.analyze(chunk), expected, atol=1e-6)

    def test_directions_and_order(self):
        signal = np.random.default_rng(1).normal(size=1024).astype(np.float32)
        for az, el in [(0, 0), (90, 0), (0, 60)]:
            a, e = np.radians([az, el])
            weights = np.array([1, np.cos(e)*np.sin(a), np.sin(e), np.cos(e)*np.cos(a)])
            chunk = (signal[:, None] * weights).astype(np.float32)
            engine = StreamingAnalyzer()
            result = engine.analyze(chunk)
            row, col = np.unravel_index(result.argmax(), result.shape)
            self.assertLess(abs((-180 + col * 360 / 140) - az), 8)
            self.assertLess(abs((-90 + row * 180 / 70) - el), 8)
            engine.reset()
            other = engine.analyze(chunk[:, [0, 3, 1, 2]], 'WXYZ')
            np.testing.assert_allclose(result, other, atol=1e-6)

    def test_silence_clears_history_and_nonfinite_rejected(self):
        engine = StreamingAnalyzer()
        engine.analyze(np.random.default_rng(2).normal(size=(1024, 4)).astype(np.float32))
        self.assertEqual(float(engine.analyze(np.zeros((1024, 4))).max()), 0)
        with self.assertRaises(ValueError):
            engine.analyze(np.full((1024, 4), np.nan))
        with self.assertRaises(ValueError):
            engine.analyze(np.zeros((1024, 2)))

    def test_rgba_flips_elevation_and_has_transparent_silence(self):
        engine = StreamingAnalyzer()
        values = np.zeros((70, 140), np.float32)
        values[0, 0] = 1
        rgba = engine.rgba(values)
        self.assertEqual(rgba.shape, (70, 140, 4))
        self.assertEqual(int(rgba[-1, -1, 3]), 255)
        self.assertEqual(int(rgba[0, 0, 3]), 0)

    def test_display_matches_skill_and_left_right_sources(self):
        signal = np.random.default_rng(9).normal(size=1024).astype(np.float32)
        for az in [90, -90]:
            a = np.radians(az)
            chunk = signal[:, None] * np.array([1, np.sin(a), 0, np.cos(a)])
            for order in ['WYZX', 'WXYZ']:
                engine = StreamingAnalyzer()
                values = engine.analyze(chunk if order == 'WYZX' else chunk[:, [0, 3, 1, 2]], order)
                rgba = engine.rgba(values)
                rgb, alpha = skill.render_map_frame(values, 140, 70, draw_grid=False)
                np.testing.assert_array_equal(rgba[:, :, :3], rgb)
                np.testing.assert_array_equal(rgba[:, :, 3], np.round(alpha * 255).astype(np.uint8))
                row, col = np.unravel_index(rgba[:, :, 3].argmax(), (70, 140))
                # AmbiX positive Y is left: +90 degrees must appear left of front.
                self.assertLess(abs(col - (35 if az > 0 else 105)), 4)
                self.assertLess(abs(row - 35), 4)


if __name__ == '__main__':
    unittest.main()
