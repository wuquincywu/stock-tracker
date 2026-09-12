import { cookies } from "next/headers";
import { cache } from "react";
import { getRegisteredUsers as getRegisteredUsersUncached } from "./redis";

export const USER_COOKIE_NAME = "stock-tracker-user";
export const USER_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Request-deduped wrapper around lib/redis.ts's getRegisteredUsers — the root layout reads this
 * directly (for UserPicker) *and* getCurrentUser below reads it again to validate the cookie;
 * without this cache() those were two separate Redis round-trips on every single navigation.
 * Import this (not the raw redis.ts export) anywhere in a page/layout's render path.
 */
export const getRegisteredUsers = cache(getRegisteredUsersUncached);

/**
 * The current device's chosen identity, or null if nobody has picked one yet. Also guards against
 * a stale cookie value — there's no user-removal flow today, but validating against the registry
 * keeps a tampered/leftover cookie from silently acting as an unregistered "ghost" user.
 *
 * Wrapped in React's `cache()` so the layout and the page it wraps (both of which need this) share
 * one lookup per request instead of two round-trips.
 */
export const getCurrentUser = cache(async (): Promise<string | null> => {
  const store = await cookies();
  const value = store.get(USER_COOKIE_NAME)?.value;
  if (!value) return null;
  const users = await getRegisteredUsers();
  return users.includes(value) ? value : null;
});
