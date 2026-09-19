// Project ERP rays into the camera, including seam crossings and polar views.
export function viewFootprint(matrix, fov, aspect, width, height) {
  const inside = new Uint8Array(width * height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const vertical = Math.tan(fov * Math.PI / 360);
  for (let y = 0; y < height; y++) {
    const elevation = (.5 - (y + .5) / height) * Math.PI;
    const cos = Math.cos(elevation); const dy = Math.sin(elevation);
    for (let x = 0; x < width; x++) {
      const azimuth = (.5 - (x + .5) / width) * 2 * Math.PI;
      const dx = -Math.sin(azimuth) * cos; const dz = -Math.cos(azimuth) * cos;
      const cx = dx * matrix[0] + dy * matrix[1] + dz * matrix[2];
      const cy = dx * matrix[4] + dy * matrix[5] + dz * matrix[6];
      const cz = dx * matrix[8] + dy * matrix[9] + dz * matrix[10];
      inside[y * width + x] = cz < 0 && Math.abs(cx) <= -cz * vertical * aspect && Math.abs(cy) <= -cz * vertical ? 1 : 0;
    }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const edge = inside[i] && (!inside[y * width + (x + width - 1) % width]
      || !inside[y * width + (x + 1) % width]
      || (y > 0 && !inside[i - width]) || (y + 1 < height && !inside[i + width]));
    if (edge) rgba.set([80, 240, 230, 255], i * 4);
    else rgba[i * 4 + 3] = inside[i] ? 0 : 145;
  }
  return rgba;
}
