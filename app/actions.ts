"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRegisteredUsers, registerUser } from "@/lib/redis";
import { USER_COOKIE_MAX_AGE_SECONDS, USER_COOKIE_NAME } from "@/lib/users";

async function setUserCookie(name: string): Promise<void> {
  const store = await cookies();
  store.set(USER_COOKIE_NAME, name, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: USER_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

/** Logs in as an already-registered user — only names present in the registry are accepted, so
 * this can't be used to fabricate an unregistered identity. */
export async function selectUser(formData: FormData): Promise<void> {
  const name = formData.get("name");
  if (typeof name !== "string") return;
  const users = await getRegisteredUsers();
  if (!users.includes(name)) return;
  await setUserCookie(name);
  redirect("/");
}

/** Registers a brand-new name (self-service — anyone with the URL can add themselves, which fits
 * this being a small trusted group with no passwords) and immediately logs in as them. */
export async function addUser(formData: FormData): Promise<void> {
  const name = formData.get("name");
  if (typeof name !== "string") return;
  const result = await registerUser(name);
  if (!result.ok) return;
  await setUserCookie(name.trim());
  redirect("/");
}

export async function switchUser(): Promise<void> {
  const store = await cookies();
  store.delete(USER_COOKIE_NAME);
  redirect("/");
}
