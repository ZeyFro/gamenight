// Préchargé uniquement par la recette : aucun appel Blob ou HTTP distant ne sort.
import assert from "node:assert/strict";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
assert.equal(process.env.GAMENIGHT_RECIPE_BLOB_ORIGIN, "http://127.0.0.1:3118");
assert.equal(process.env.NODE_ENV, "development");
const dispatcher = getGlobalDispatcher();
setGlobalDispatcher({
  dispatch(options, handler) {
    const url = new URL(options.origin);
    if (url.hostname === "blob.vercel-storage.com" || url.hostname === "fixture.private.blob.vercel-storage.com") {
      return dispatcher.dispatch({ ...options, origin: process.env.GAMENIGHT_RECIPE_BLOB_ORIGIN }, handler);
    }
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return dispatcher.dispatch(options, handler);
    queueMicrotask(() => handler.onError(new Error(`Recette : HTTP externe interdit (${url.hostname})`)));
    return false;
  },
  close: (...args) => dispatcher.close(...args),
  destroy: (...args) => dispatcher.destroy(...args),
});
