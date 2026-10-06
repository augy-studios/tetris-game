// Short replay links. The data is a replay link's packed game, as
// script.js makes it (packReplay): base64url, its first byte the format
// version, with the high bit set when deflated. Checked for shape only; the
// page checks every piece as it plays it back, and a damaged one says so.

import { HttpError } from "./http.js";

export const MAX_DATA = 100000;
const ID = /^[0-9A-Za-z]{8,16}$/;

export function replayData(value) {
  const data = typeof value === "string" ? value.trim() : "";
  // "A"/"B" open version 1 as is, "g"/"h" version 1 deflated.
  if (!data || data.length > MAX_DATA || !/^[ABgh][A-Za-z0-9_-]+$/.test(data)) {
    throw new HttpError(400, "bad_replay", "That is not a replay.");
  }
  return data;
}

export function replayId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!ID.test(id)) throw new HttpError(400, "bad_id", "That is not a replay link.");
  return id;
}
