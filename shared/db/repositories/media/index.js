import { getDb } from "../../getClient.js";

export function assets() {
  return getDb().mediaAsset;
}
