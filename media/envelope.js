export function attachEnvelope(player, canvas) {
  const draw = () => {
    const { width, height } = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    const channels = player.envelope;
    if (!channels?.length) return;
    const colors = ['#6bce9f', '#4fafe0', '#ecc389', '#df8bab'];
    const row = canvas.height / channels.length;
    const played = player.currentTime / player.duration * canvas.width;
    channels.forEach((peaks, ch) => {
      ctx.fillStyle = colors[ch] || `hsl(${(ch * 137.508) % 360} 60% 65%)`;
      for (let x = 0; x < canvas.width; x++) {
        const start = Math.floor(x / canvas.width * peaks.length);
        const end = Math.min(peaks.length, Math.ceil((x + 1) / canvas.width * peaks.length));
        let peak = 0;
        for (let i = start; i < end; i++) peak = Math.max(peak, peaks[i]);
        // A shared square-root scale keeps quiet channels visible in the compact rows.
        const minimum = Math.min(scale, row * .15);
        const h = Math.max(minimum, Math.sqrt(Math.min(1, peak)) * (row - minimum));
        ctx.globalAlpha = x <= played ? 1 : .5;
        ctx.fillRect(x, ch * row + (row - h) / 2, 1, h);
      }
    });
  };
  player.addEventListener('envelope', draw);
  player.addEventListener('timeupdate', draw);
  player.addEventListener('seeking', draw);
  window.addEventListener('resize', draw);
}
