// Préchargé uniquement par la recette : aucun appel Blob ou HTTP distant ne sort.
import assert from "node:assert/strict";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { createRecipeSafeDispatcher } from "./recette-medias-dispatcher.mjs";
assert.equal(process.env.GAMENIGHT_RECIPE_BLOB_ORIGIN, "http://127.0.0.1:3118");
assert.equal(process.env.NODE_ENV, "development");
const dispatcher = getGlobalDispatcher();
setGlobalDispatcher(createRecipeSafeDispatcher(dispatcher, process.env.GAMENIGHT_RECIPE_BLOB_ORIGIN));
