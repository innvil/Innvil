import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOLICITATION_DEFAULT_OFF_GUIDANCE,
  SOLICITATION_OPTIONS_GUIDANCE,
  SOLICITATION_TOGGLE_HELPER_TEXT,
  PROMOTION_TOPIC_HELPER_TEXT,
  RECOMMENDED_SETUP_GUIDANCE,
  solicitationSettingsHref,
  promotionTopicHref,
  SOLICITATION_SETTINGS_ANCHOR_ID,
  PROMOTION_TOPIC_ANCHOR_ID,
} from "./community-guidance";

// (5) states solicitation is OFF by default
test("guidance states solicitation is OFF by default, covering every named promotional category", () => {
  assert.match(SOLICITATION_DEFAULT_OFF_GUIDANCE, /off by default/i);
  for (const term of ["DM me", "service promotion", "project promotion", "referral promotion"]) {
    assert.ok(SOLICITATION_DEFAULT_OFF_GUIDANCE.includes(term), `missing "${term}"`);
  }
});

// (6) explains what happens when global solicitation is enabled
test("guidance explains the effect of enabling global solicitation, and points at Solicitation Settings", () => {
  assert.match(SOLICITATION_OPTIONS_GUIDANCE, /allow solicitation across your entire community/i);
  assert.ok(SOLICITATION_OPTIONS_GUIDANCE.includes("Solicitation Settings"));
});

// (7) explains the recommended Promotion-topic setup
test("guidance explains the recommended Promotion-topic setup", () => {
  assert.match(RECOMMENDED_SETUP_GUIDANCE, /keep solicitation off globally/i);
  assert.match(RECOMMENDED_SETUP_GUIDANCE, /promotion topic/i);
});

// (8) Promotion-topic override behavior is clearly described
test("promotion-topic helper text describes the override behavior even when solicitation is globally OFF", () => {
  assert.match(PROMOTION_TOPIC_HELPER_TEXT, /allow solicitation.*even when solicitation is globally off/i);
});

test("solicitation toggle helper text states the default and what turning it on does", () => {
  assert.match(SOLICITATION_TOGGLE_HELPER_TEXT, /off by default/i);
  assert.match(SOLICITATION_TOGGLE_HELPER_TEXT, /turning this on allows solicitation/i);
});

// (1)/(2) "Solicitation Settings" link routes to the exact solicitation setting
test("solicitationSettingsHref routes directly to the solicitation section on the Settings tab, never a generic settings link", () => {
  const href = solicitationSettingsHref();
  assert.ok(href.includes("tab=settings"));
  assert.ok(href.includes(`#${SOLICITATION_SETTINGS_ANCHOR_ID}`));
  assert.equal(href, "?tab=settings#solicitation-settings");
});

// (3)/(4) "Configure Promotion Topic" link routes to the topic-policy config
test("promotionTopicHref routes directly to the Promotion topic configuration, never a generic settings link", () => {
  const href = promotionTopicHref();
  assert.ok(href.includes("tab=settings"));
  assert.ok(href.includes(`#${PROMOTION_TOPIC_ANCHOR_ID}`));
  assert.equal(href, "?tab=settings#promotion-topic");
});

// (9) no generic/dead-end link is used when a direct link is available
test("neither href is a bare/generic settings link -- both carry a specific in-page anchor", () => {
  for (const href of [solicitationSettingsHref(), promotionTopicHref()]) {
    assert.notEqual(href, "?tab=settings");
    assert.ok(href.includes("#"), "must include a specific anchor, not just the tab");
  }
});
