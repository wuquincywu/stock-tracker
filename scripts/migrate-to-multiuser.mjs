#!/usr/bin/env node
// One-time migration for the multi-user change: before this, watchlist/push-subscriptions/
// alert-dedup/alert-config/chart-months were single global records; now each is namespaced per
// registered user (see lib/redis.ts, lib/users.ts). This copies the existing global data to the
// given user name and registers them in users:list, so their pre-existing tracked stocks, alert
// settings, push subscription, and dedup history keep working without any gap or duplicate alert.
//
// Old global keys are left in place untouched (not deleted) — nothing in the app reads them
// anymore after this change ships, so they're just inert leftovers, kept around in case anything
// needs double-checking before a manual cleanup.
//
// Usage: node --env-file=.env.local scripts/migrate-to-multiuser.mjs <username>

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const targetUser = process.argv[2];
if (!targetUser) {
  console.error("Usage: node --env-file=.env.local scripts/migrate-to-multiuser.mjs <username>");
  process.exit(1);
}

const HASH_MOVES = [
  ["watchlist", `watchlist:${targetUser}`],
  ["push:subscriptions", `push:subscriptions:${targetUser}`],
  ["alert:dedup", `alert:dedup:${targetUser}`],
];

const VALUE_MOVES = [
  ["config:alerts", `config:alerts:${targetUser}`],
  ["config:chartMonths", `config:chartMonths:${targetUser}`],
];

async function main() {
  console.log(`Migrating existing global data to user "${targetUser}"...`);

  for (const [oldKey, newKey] of HASH_MOVES) {
    const data = await redis.hgetall(oldKey);
    if (data && Object.keys(data).length > 0) {
      await redis.hset(newKey, data);
      console.log(`  ${oldKey} -> ${newKey}: ${Object.keys(data).length} field(s)`);
    } else {
      console.log(`  ${oldKey}: nothing to migrate`);
    }
  }

  for (const [oldKey, newKey] of VALUE_MOVES) {
    const value = await redis.get(oldKey);
    if (value !== null && value !== undefined) {
      await redis.set(newKey, value);
      console.log(`  ${oldKey} -> ${newKey}: migrated`);
    } else {
      console.log(`  ${oldKey}: nothing to migrate`);
    }
  }

  const users = (await redis.get("users:list")) ?? [];
  if (!users.includes(targetUser)) {
    await redis.set("users:list", [...users, targetUser]);
    console.log(`Registered "${targetUser}" in users:list`);
  } else {
    console.log(`"${targetUser}" already registered`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
