import { httpError } from "./auth.mjs";

export const HISTORY_PAGE_SIZE = 20;
const unsupported = (error) =>
  /unsupported|not supported|unknown method|method not found|legacy|paginated/i.test(
    error.message,
  );
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function decode(cursor) {
  if (!cursor) return { mode: "items" };
  try {
    if (typeof cursor !== "string" || cursor.length > 8192) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url"));
    if (
      !["items", "turns"].includes(value.mode) ||
      (value.cursor != null && typeof value.cursor !== "string") ||
      (value.before != null && typeof value.before !== "string")
    )
      throw new Error();
    return value;
  } catch {
    throw httpError(
      400,
      "Ungültige Position im Chatverlauf. Bitte den Chat erneut öffnen.",
    );
  }
}
function displayItem(item) {
  if (item.type !== "imageGeneration") return item;
  // The existing image endpoint resolves the saved file or persisted image content.
  // Sending that content again in every history page makes image-heavy chats slow.
  const { result, ...rest } = item;
  return { ...rest, ...(result ? { consoleImageAvailable: true } : {}) };
}

const turnMetadata = new WeakMap();
async function metadataFor(bridge, threadId, entries, firstPage) {
  let cache = turnMetadata.get(bridge);
  if (!cache) turnMetadata.set(bridge, (cache = new Map()));
  let current = cache.get(threadId);
  if (firstPage || !current || Date.now() - current.at > 60000) {
    current = {
      turns: new Map(),
      cursor: null,
      started: false,
      at: Date.now(),
    };
    cache.set(threadId, current);
    if (cache.size > 30) cache.delete(cache.keys().next().value);
  }
  const needed = new Set(entries.map((entry) => entry.turnId));
  const seen = new Set();
  while (
    !current.started ||
    ([...needed].some((id) => !current.turns.has(id)) && current.cursor)
  ) {
    if (seen.has(current.cursor))
      throw httpError(
        502,
        "Der Chatverlauf konnte nicht weiter geladen werden.",
      );
    seen.add(current.cursor);
    const page = await bridge.call("thread/turns/list", {
      threadId,
      itemsView: "notLoaded",
      limit: 20,
      sortDirection: "desc",
      ...(current.cursor ? { cursor: current.cursor } : {}),
    });
    for (const turn of page.data)
      current.turns.set(turn.id, { ...turn, items: [] });
    current.cursor = page.nextCursor;
    current.started = true;
  }
  return current.turns;
}

async function itemPage(bridge, threadId, position, includeActive = false) {
  const page = await bridge.call("thread/items/list", {
    threadId,
    limit: HISTORY_PAGE_SIZE,
    sortDirection: "desc",
    ...(position.cursor ? { cursor: position.cursor } : {}),
  });
  const metadata = await metadataFor(
    bridge,
    threadId,
    page.data,
    !position.cursor,
  );
  const turns = new Map();
  for (const { turnId, item } of [...page.data].reverse()) {
    if (!turns.has(turnId))
      turns.set(turnId, {
        ...(metadata.get(turnId) || { id: turnId, status: "completed" }),
        items: [],
      });
    turns.get(turnId).items.push(displayItem(item));
  }
  // An active turn may not contain an item yet, but still needs Stop/steer controls.
  if (!position.cursor || includeActive)
    for (const turn of metadata.values())
      if (turn.status === "inProgress" && !turns.has(turn.id))
        turns.set(turn.id, { ...turn, items: [] });
  return {
    data: [...turns.values()],
    nextCursor: page.nextCursor
      ? encode({ mode: "items", cursor: page.nextCursor })
      : null,
    pageSize: HISTORY_PAGE_SIZE,
  };
}

async function legacyPage(bridge, threadId, position) {
  const turns = [],
    seen = new Set();
  let cursor = position.cursor,
    before = position.before,
    remaining = HISTORY_PAGE_SIZE;
  for (;;) {
    const key = cursor || "";
    if (seen.has(key))
      throw httpError(
        502,
        "Der Chatverlauf konnte nicht weiter geladen werden.",
      );
    seen.add(key);
    const page = await bridge.call("thread/turns/list", {
      threadId,
      itemsView: "full",
      limit: 1,
      sortDirection: "desc",
      ...(cursor ? { cursor } : {}),
    });
    const turn = page.data[0];
    if (!turn)
      return {
        data: turns.reverse(),
        nextCursor: null,
        pageSize: HISTORY_PAGE_SIZE,
      };
    const items = turn.items || [];
    let end = items.length;
    if (before) {
      end = items.findIndex((item) => item.id === before);
      if (end < 0)
        throw httpError(
          409,
          "Der Chatverlauf hat sich geändert. Bitte den Chat erneut öffnen.",
        );
    }
    const start = Math.max(0, end - remaining);
    turns.push({ ...turn, items: items.slice(start, end).map(displayItem) });
    remaining -= Math.max(1, end - start);
    if (start > 0)
      return {
        data: turns.reverse(),
        nextCursor: encode({
          mode: "turns",
          cursor: cursor || null,
          before: items[start].id,
        }),
        pageSize: HISTORY_PAGE_SIZE,
      };
    if (!page.nextCursor || !remaining)
      return {
        data: turns.reverse(),
        nextCursor: page.nextCursor
          ? encode({ mode: "turns", cursor: page.nextCursor })
          : null,
        pageSize: HISTORY_PAGE_SIZE,
      };
    cursor = page.nextCursor;
    before = null;
  }
}

export async function readHistory(
  bridge,
  threadId,
  cursor,
  { includeActive = false } = {},
) {
  const position = decode(cursor);
  if (position.mode === "turns") return legacyPage(bridge, threadId, position);
  try {
    return await itemPage(bridge, threadId, position, includeActive);
  } catch (error) {
    if (position.cursor || !unsupported(error)) throw error;
    return legacyPage(bridge, threadId, { mode: "turns" });
  }
}
