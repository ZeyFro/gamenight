import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./recette-complements.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /networkidle/, "the recipe must synchronize on visible application state, not network quiescence");
assert.match(source, /waitForFunction\(\(\) => Array\.isArray\(window\.__radarScrollMeasurements\)\)/, "roulette sampler must wait for its completed measurements");
const subscriptionStep = source.indexOf('await step("abonnement : section visible, création d\'un lien privé, flux .ics sans cookie"');
assert.notEqual(subscriptionStep, -1, "calendar subscription step must exist");
const feedUrlAssignment = source.indexOf("activeFeed = url;", subscriptionStep);
const prewarm = source.indexOf('const warmup = await anonymous.request.get(`${origin}/api/calendrier/feed/warmup`, { timeout: 120_000 });', subscriptionStep);
const realFeedRequest = source.indexOf("const response = await feed(url);", subscriptionStep);
assert.ok(feedUrlAssignment < prewarm && prewarm < realFeedRequest, "malformed bounded prewarm must precede the real token request, and preserve activeFeed for dependent checks");
console.log("OK complement recipe waits for app state and prewarms the calendar handler safely");
