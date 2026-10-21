export function createRecipeSafeDispatcher(dispatcher, blobOrigin) {
  return {
    dispatch(options, handler) {
      const url = new URL(options.origin);
      if (url.hostname === "blob.vercel-storage.com" || url.hostname === "fixture.private.blob.vercel-storage.com") {
        return dispatcher.dispatch({ ...options, origin: blobOrigin }, handler);
      }
      if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return dispatcher.dispatch(options, handler);
      queueMicrotask(() => handler.onError(new Error(`Recette : HTTP externe interdit (${url.hostname})`)));
      return true;
    },
    close: (...args) => dispatcher.close(...args),
    destroy: (...args) => dispatcher.destroy(...args),
  };
}
