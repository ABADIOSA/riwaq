// Contrast of an element's text against what is actually drawn behind it,
// from pixels (scripts/test-ui-feedback.mjs, scripts/test-ui-brand-glass.mjs).
/**
 * Contrast of an element's text against what is actually drawn behind its
 * glyphs. The element is captured twice, as drawn and with its text made
 * transparent: the pixels that differ are the glyphs, the second capture is
 * the background under them (glass, sheen, artwork), and the text colour is
 * the element's own computed colour composited over that background. The
 * result is a low percentile over the glyph pixels, so one stray
 * anti-aliased pixel cannot decide it and a bright decoration elsewhere in
 * the box (a border, an icon) cannot stand in for the text.
 */
export async function drawnContrast(page, locator) {
  const drawn = await locator.screenshot({ animations: "disabled" });
  const color = await locator.evaluate((el) => getComputedStyle(el).color);
  const style = await locator.evaluate((el) => {
    const s = document.createElement("style");
    s.dataset.contrastProbe = "";
    el.dataset.contrastProbe = "";
    s.textContent =
      "[data-contrast-probe], [data-contrast-probe] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }";
    document.head.append(s);
    return true;
  });
  if (!style) throw new Error("contrast probe was not installed");
  const under = await locator.screenshot({ animations: "disabled" });
  await locator.evaluate((el) => {
    delete el.dataset.contrastProbe;
    document.querySelector("style[data-contrast-probe]")?.remove();
  });
  return page.evaluate(
    async ([a, b, color]) => {
      const pixels = async (data) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const [pa, pb] = await Promise.all([pixels(a), pixels(b)]);
      const lum = (r, g, bl) => {
        const c = [r, g, bl].map((v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const [tr, tg, tb, ta = 1] = color.match(/[\d.]+/g).map(Number);
      const ratios = [];
      for (let i = 0; i < pa.length; i += 4) {
        const diff =
          Math.abs(pa[i] - pb[i]) +
          Math.abs(pa[i + 1] - pb[i + 1]) +
          Math.abs(pa[i + 2] - pb[i + 2]);
        if (diff < 24) continue;
        const [br, bg, bb] = [pb[i], pb[i + 1], pb[i + 2]];
        const text = lum(
          tr * ta + br * (1 - ta),
          tg * ta + bg * (1 - ta),
          tb * ta + bb * (1 - ta),
        );
        const back = lum(br, bg, bb);
        ratios.push(
          (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05),
        );
      }
      if (ratios.length < 8) return { ratio: 0, glyphs: ratios.length };
      ratios.sort((x, y) => x - y);
      return {
        ratio: Math.round(ratios[Math.floor(ratios.length * 0.05)] * 100) / 100,
        glyphs: ratios.length,
      };
    },
    [drawn.toString("base64"), under.toString("base64"), color],
  );
}
