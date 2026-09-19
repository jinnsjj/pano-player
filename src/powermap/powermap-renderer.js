import { GRID_HEIGHT, GRID_WIDTH } from './powermap-math.js';

export const POWERMAP_COLOUR_TABLE = Object.freeze([
  [61, 0, 209], [59, 7, 208], [56, 22, 208], [54, 29, 208],
  [51, 44, 207], [47, 58, 207], [44, 73, 207], [44, 75, 207],
  [43, 80, 207], [43, 82, 207], [41, 88, 206], [41, 90, 206],
  [40, 91, 206], [39, 95, 206], [39, 97, 206], [39, 99, 206],
  [38, 102, 206], [38, 104, 206], [37, 106, 206], [36, 110, 206],
  [36, 112, 206], [35, 114, 206], [34, 117, 206], [34, 119, 206],
  [34, 121, 206], [33, 125, 206], [33, 127, 206], [32, 127, 206],
  [32, 128, 206], [31, 132, 205], [31, 134, 205], [31, 135, 205],
  [30, 136, 205], [30, 138, 205], [30, 139, 205], [30, 141, 205],
  [29, 143, 205], [29, 145, 205], [28, 147, 205], [27, 150, 205],
  [26, 154, 205], [26, 156, 205], [26, 158, 205], [25, 161, 205],
  [24, 165, 205], [24, 167, 205], [23, 169, 205], [22, 172, 205],
  [21, 176, 204], [21, 180, 204], [20, 183, 204], [19, 187, 204],
  [18, 191, 204], [17, 194, 204], [17, 198, 204], [16, 202, 213],
  [15, 205, 204], [14, 209, 204], [13, 213, 204], [13, 217, 204],
  [16, 217, 189], [19, 217, 176], [23, 218, 162], [26, 218, 150],
  [30, 218, 137], [33, 219, 125], [37, 219, 114], [41, 220, 103],
  [44, 220, 93], [48, 221, 83], [51, 221, 73], [55, 222, 64],
  [61, 222, 59], [77, 222, 62], [106, 223, 69], [120, 224, 73],
  [133, 224, 77], [147, 225, 81], [152, 222, 77], [158, 220, 73],
  [163, 218, 69], [175, 213, 65], [180, 211, 57], [186, 208, 53],
  [192, 206, 49], [197, 204, 45], [203, 201, 41], [208, 199, 37],
  [214, 197, 33], [220, 194, 29], [225, 192, 25], [231, 190, 21],
  [237, 187, 17], [242, 185, 13], [248, 183, 9], [254, 181, 6],
  [254, 184, 5], [254, 188, 5], [254, 192, 5], [254, 196, 5],
  [254, 200, 5], [254, 204, 5], [254, 208, 5], [254, 212, 5],
  [254, 216, 5], [254, 220, 5], [254, 224, 5], [254, 228, 5],
  [254, 236, 5], [254, 240, 5], [254, 244, 5], [254, 248, 5],
  [254, 252, 5], [253, 255, 5],
]);

export function colourizeMap(powerMap, {
  width = GRID_WIDTH,
  height = GRID_HEIGHT,
} = {}) {
  if (!(powerMap instanceof Float32Array || powerMap instanceof Float64Array)
      || powerMap.length !== width * height) {
    throw new TypeError(`PowerMap must contain ${width * height} values`);
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const source = (height - row - 1) * width + (width - column - 1);
      const value = Math.max(0, Math.min(1, powerMap[source]));
      const alpha = Math.log2(1 + value);
      const colorIndex = Math.min(
        Math.floor(alpha * POWERMAP_COLOUR_TABLE.length),
        POWERMAP_COLOUR_TABLE.length - 1,
      );
      const target = (row * width + column) * 4;
      const color = POWERMAP_COLOUR_TABLE[colorIndex];
      pixels[target] = color[0];
      pixels[target + 1] = color[1];
      pixels[target + 2] = color[2];
      pixels[target + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

function drawGrid(context, width, height) {
  context.save();
  context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  context.lineWidth = 1;
  for (let index = 0; index <= 8; index += 1) {
    const x = Math.min(Math.round(index * width / 8), width - 0.5);
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let index = 0; index <= 4; index += 1) {
    const y = Math.min(Math.round(index * height / 4), height - 0.5);
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.strokeStyle = 'rgba(255, 255, 255, 0.62)';
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.moveTo(width / 2, 0);
  context.lineTo(width / 2, height);
  context.stroke();

  context.fillStyle = 'rgba(255, 255, 255, 0.82)';
  context.font = '10px Instrument Sans, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  ['180', '135', '90', '45', '0', '-45', '-90', '-135', '-180'].forEach(
    (label, index) => context.fillText(label, index * width / 8, height / 2 + 4),
  );
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  ['90', '45', '0', '-45', '-90'].forEach(
    (label, index) => context.fillText(label, width / 2 + 5, index * height / 4),
  );
  context.restore();
}

export class PowermapRenderer {
  constructor(canvas, { width = 560, height = 280 } = {}) {
    this.canvas = canvas;
    this.canvas.width = width;
    this.canvas.height = height;
    this.context = canvas.getContext('2d', { alpha: true });
    this.sourceCanvas = document.createElement('canvas');
    this.sourceCanvas.width = GRID_WIDTH;
    this.sourceCanvas.height = GRID_HEIGHT;
    this.sourceContext = this.sourceCanvas.getContext('2d', { alpha: true });
  }

  render(powerMap) {
    const pixels = colourizeMap(powerMap);
    const image = new ImageData(pixels, GRID_WIDTH, GRID_HEIGHT);
    this.sourceContext.putImageData(image, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.imageSmoothingEnabled = true;
    this.context.drawImage(this.sourceCanvas, 0, 0, this.canvas.width, this.canvas.height);
    drawGrid(this.context, this.canvas.width, this.canvas.height);
  }

  clear() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
