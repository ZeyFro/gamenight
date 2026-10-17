import { describe, expect, it } from "vitest";
import { parseWebPushSubscription } from "./web-push-subscription";

describe("validation d'abonnement Web Push", () => {
  const valid = {
    endpoint: "https://fcm.googleapis.com/fcm/send/example",
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  };

  it("accepte une souscription HTTPS d'un fournisseur navigateur connu", () => {
    expect(parseWebPushSubscription(valid)).toEqual(valid);
    expect(parseWebPushSubscription({ ...valid, endpoint: "https://updates.push.services.mozilla.com/wpush/v2/id" })).not.toBeNull();
    expect(parseWebPushSubscription({ ...valid, endpoint: "https://web.push.apple.com/id" })).not.toBeNull();
  });

  it("refuse les destinations arbitraires et les clés malformées", () => {
    expect(parseWebPushSubscription({ ...valid, endpoint: "http://fcm.googleapis.com/send" })).toBeNull();
    expect(parseWebPushSubscription({ ...valid, endpoint: "https://127.0.0.1/push" })).toBeNull();
    expect(parseWebPushSubscription({ ...valid, keys: { ...valid.keys, auth: "short" } })).toBeNull();
    expect(parseWebPushSubscription({ ...valid, keys: { auth: "bad" } })).toBeNull();
  });
});
