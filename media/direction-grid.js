// Full-sphere ERP coordinates: front at center, positive azimuth to the left.
export function drawDirectionGrid(canvas, enabled, opacity = 1) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  if (!enabled) return;
  const x = azimuth => (.5 - azimuth / 360) * width;
  const y = elevation => (.5 - elevation / 180) * height;
  function line(x1, y1, x2, y2, accent) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = '#00000080'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.strokeStyle = accent || '#edf0f270'; ctx.lineWidth = accent ? 2 : 1; ctx.stroke();
  }
  function label(text, left, top, align = 'center', accent = '#edf0f2') {
    ctx.textAlign = align; ctx.strokeStyle = '#08090ae6'; ctx.lineWidth = 5;
    ctx.strokeText(text, left, top); ctx.fillStyle = accent; ctx.fillText(text, left, top);
  }
  ctx.save(); ctx.globalAlpha = opacity;
  ctx.font = '500 24px sans-serif'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (let az = -180; az <= 180; az += 30) line(x(az), 0, x(az), height, az === 0 ? '#83dfc5b3' : null);
  for (let el = -60; el <= 60; el += 30) line(0, y(el), width, y(el), el === 0 ? '#ecc389cc' : null);
  for (let az = -150; az <= 150; az += 30) {
    const name = az === 0 ? 'Front 0\u00b0' : az === 90 ? 'Left +90\u00b0' : az === -90 ? 'Right -90\u00b0' : `${az > 0 ? '+' : ''}${az}\u00b0`;
    label(name, x(az), height / 2 + 28);
  }
  label('Back +180\u00b0', 12, height / 2 - 28, 'left');
  label('Back -180\u00b0', width - 12, height / 2 - 28, 'right');
  for (const el of [-60, -30, 30, 60]) label(`${el > 0 ? '+' : ''}${el}\u00b0`, width / 2 + 12, y(el) - 20, 'left');
  ctx.restore();
}
