import { google } from "googleapis";
const p = google.androidpublisher({ version: "v3" });
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(p.purchases.subscriptions)));
