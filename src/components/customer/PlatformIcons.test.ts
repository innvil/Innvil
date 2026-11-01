import assert from "node:assert/strict";
import test from "node:test";
import { GLYPH_PATHS, platformBrandIconSlug } from "./PlatformIcons";

test("known platform glyphs retain their local brand paths", () => {
  for (const key of ["instagram", "tiktok", "youtube", "x", "facebook", "telegram", "spotify", "linkedin", "bluesky"]) {
    assert.ok(GLYPH_PATHS[key], "missing local logo for " + key);
  }
});

test("provider-imported platform names resolve to a brand icon slug automatically", () => {
  for (const key of ["twitch", "discord", "reddit", "pinterest", "snapchat", "threads", "soundcloud", "kick", "rumble"]) {
    assert.equal(platformBrandIconSlug(key), key);
  }
});
