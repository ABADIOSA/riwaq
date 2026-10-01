import test from "node:test";
import assert from "node:assert/strict";
import {
  AMBIENT_BLURS,
  ambientOptions,
  artOfElement,
  cardArt,
  layerStyle,
} from "../core/ambient.mjs";
import { safeAppearance, themeVariables } from "../core/appearance.mjs";

test("the glow follows the pointer by default and every choice is validated", () => {
  const a = safeAppearance({ ambient: "artwork" });
  assert.equal(a.ambientFollow, "hover");
  assert.equal(a.ambientLeave, "return");
  const bad = safeAppearance({
    ambient: "artwork",
    ambientFollow: "mouse",
    ambientLeave: "never",
    ambientImage: "logo",
    ambientBlur: "max",
    ambientDelay: 99999,
    ambientStrength: -4,
    ambientFade: "slow",
  });
  assert.equal(bad.ambientFollow, "hover");
  assert.equal(bad.ambientLeave, "return");
  assert.equal(bad.ambientImage, "backdrop");
  assert.equal(bad.ambientBlur, "medium");
  assert.equal(bad.ambientDelay, 1500);
  assert.equal(bad.ambientStrength, 5);
  assert.equal(bad.ambientFade, 700);
  const good = safeAppearance({
    ambient: "artwork",
    ambientFollow: "hero",
    ambientLeave: "stay",
    ambientImage: "poster",
    ambientBlur: "strong",
    ambientDelay: 0,
    ambientStrength: 40,
    ambientFade: 0,
  });
  const o = ambientOptions(good);
  assert.deepEqual(
    [o.on, o.follow, o.leave, o.image, o.delay, o.fade, o.opacity],
    [true, "hero", "stay", "poster", 0, 0, 0.4],
  );
  assert.deepEqual([o.size, o.scale, o.blur], AMBIENT_BLURS.strong);
  // The glow never reaches the app root as a variable.
  assert.ok(!Object.keys(themeVariables(good)).some((k) => /ambient/.test(k)));
});

test("every blur choice covers the whole window", () => {
  for (const [size, scale] of Object.values(AMBIENT_BLURS))
    assert.ok(size * scale >= 120, `${size} × ${scale}`);
});

test("a card lends its backdrop, metahub's, or its poster; never an unsafe address", () => {
  assert.deepEqual(
    cardArt({
      id: "tt0111161",
      background: "https://img.example/b.jpg",
      poster: "https://img.example/p.jpg",
    }),
    {
      backdrop: "https://img.example/b.jpg",
      poster: "https://img.example/p.jpg",
    },
  );
  assert.equal(
    cardArt({ id: "tt0111161:1:2" }).backdrop,
    "https://images.metahub.space/background/medium/tt0111161/img",
  );
  assert.deepEqual(
    cardArt({
      id: "kitsu:1",
      background: "http://img.example/b.jpg",
      poster: "https://u:p@img.example/p.jpg",
    }),
    { backdrop: "", poster: "" },
  );
  const el = {
    dataset: {
      ambient: "https://img.example/b.jpg",
      ambientPoster: "https://img.example/p.jpg",
    },
  };
  assert.equal(artOfElement(el), "https://img.example/b.jpg");
  assert.equal(artOfElement(el, "poster"), "https://img.example/p.jpg");
  assert.equal(
    artOfElement({ dataset: { ambient: "javascript:alert(1)" } }),
    "",
  );
});

test("a layer's style carries its own picture, strength and fade", () => {
  const o = ambientOptions(safeAppearance({ ambient: "artwork" }));
  const shown = layerStyle("https://img.example/b.jpg", o, true);
  assert.equal(shown.backgroundImage, 'url("https://img.example/b.jpg")');
  assert.equal(shown.opacity, 0.24);
  assert.equal(shown.transform, "scale(30)");
  assert.equal(shown.transition, "opacity 700ms ease");
  assert.equal(layerStyle("", o, false).opacity, 0);
});
