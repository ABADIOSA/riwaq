/**
 * Riwaq's mark (three arches) drawn in the accent colour on a rounded tile,
 * as a 256-pixel PNG for the taskbar. Only the picture crosses to main.
 */
export function drawAppIcon(accent, background) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return "";
  const r = 56;
  g.fillStyle = background;
  g.beginPath();
  g.moveTo(r, 0);
  g.arcTo(size, 0, size, size, r);
  g.arcTo(size, size, 0, size, r);
  g.arcTo(0, size, 0, 0, r);
  g.arcTo(0, 0, size, 0, r);
  g.closePath();
  g.fill();
  // The arches lean slightly, as they do in the sidebar.
  g.translate(size / 2, size / 2);
  g.transform(1, -0.12, 0, 1, 0, 0);
  g.translate(-size / 2, -size / 2);
  const width = 44;
  const gap = 14;
  const left = (size - (width * 3 + gap * 2)) / 2;
  const bottom = 196;
  const heights = [140, 110, 80];
  g.lineWidth = 11;
  g.strokeStyle = accent;
  g.fillStyle = accent;
  heights.forEach((h, i) => {
    const x = left + i * (width + gap);
    const top = bottom - h;
    const rad = width / 2;
    g.beginPath();
    g.moveTo(x, bottom);
    g.lineTo(x, top + rad);
    g.arc(x + rad, top + rad, rad, Math.PI, 0);
    g.lineTo(x + width, bottom);
    if (i === 1) {
      g.closePath();
      g.fill();
    } else g.stroke();
  });
  return canvas.toDataURL("image/png");
}
