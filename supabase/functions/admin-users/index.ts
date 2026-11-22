// Account management for administrators.
// Creating, renaming, re-keying and deleting logins needs the service role,
// which must never reach the browser, so it lives here.
import { createClient } from "npm:@supabase/supabase-js@2";

const LOGIN_DOMAIN = "scara-tec.invalid";
const USERNAME_RE = /^[a-z0-9._-]{2,40}$/;
const ROLES = ["admin", "baulajter", "radnik"];
const MIN_PASSWORD = 6;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const fail = (code: string, status = 400) => json({ error: code }, status);

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who is calling, and are they an administrator?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return fail("UNAUTHENTICATED", 401);
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return fail("UNAUTHENTICATED", 401);
  const callerId = caller.user.id;

  const { data: callerProfile } = await admin
    .from("profiles").select("role").eq("id", callerId).maybeSingle();
  if (callerProfile?.role !== "admin") return fail("FORBIDDEN", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_JSON");
  }

  const action = body.action;

  if (action === "create") {
    const name = str(body.name, 120);
    const username = str(body.username, 40).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const role = str(body.role, 20);
    if (!name) return fail("NAME_REQUIRED");
    if (!USERNAME_RE.test(username)) return fail("USERNAME_INVALID");
    if (password.length < MIN_PASSWORD || password.length > 72) return fail("PASSWORD_TOO_SHORT");
    if (!ROLES.includes(role)) return fail("ROLE_INVALID");

    const { data: taken } = await admin
      .from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) return fail("USERNAME_TAKEN", 409);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: `${username}@${LOGIN_DOMAIN}`,
      password,
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      console.error("createUser failed", createErr?.message);
      return fail("CREATE_FAILED", 500);
    }

    const { error: profileErr } = await admin.from("profiles").insert({
      id: created.user.id,
      name,
      username,
      role,
      email: str(body.email, 200),
      phone: str(body.phone, 60),
    });
    if (profileErr) {
      console.error("profile insert failed", profileErr.message);
      await admin.auth.admin.deleteUser(created.user.id);
      return fail(profileErr.code === "23505" ? "USERNAME_TAKEN" : "CREATE_FAILED", 500);
    }
    return json({ id: created.user.id });
  }

  if (action === "update") {
    const id = str(body.id, 60);
    const username = str(body.username, 40).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (!id) return fail("ID_REQUIRED");
    if (!USERNAME_RE.test(username)) return fail("USERNAME_INVALID");
    if (password && (password.length < MIN_PASSWORD || password.length > 72)) {
      return fail("PASSWORD_TOO_SHORT");
    }

    const { data: target } = await admin
      .from("profiles").select("id, username").eq("id", id).maybeSingle();
    if (!target) return fail("NOT_FOUND", 404);

    if (username !== target.username) {
      const { data: taken } = await admin
        .from("profiles").select("id").eq("username", username).neq("id", id).maybeSingle();
      if (taken) return fail("USERNAME_TAKEN", 409);
    }

    const authPatch: Record<string, unknown> = {};
    if (username !== target.username) {
      authPatch.email = `${username}@${LOGIN_DOMAIN}`;
      authPatch.email_confirm = true;
    }
    if (password) authPatch.password = password;
    if (Object.keys(authPatch).length > 0) {
      const { error: authErr } = await admin.auth.admin.updateUserById(id, authPatch);
      if (authErr) {
        console.error("updateUserById failed", authErr.message);
        return fail("UPDATE_FAILED", 500);
      }
    }

    const { error: profileErr } = await admin.from("profiles").update({
      username,
      email: str(body.email, 200),
      phone: str(body.phone, 60),
    }).eq("id", id);
    if (profileErr) {
      console.error("profile update failed", profileErr.message);
      return fail("UPDATE_FAILED", 500);
    }
    return json({ id });
  }

  if (action === "delete") {
    const id = str(body.id, 60);
    if (!id) return fail("ID_REQUIRED");
    if (id === callerId) return fail("CANNOT_DELETE_SELF");

    const { data: target } = await admin
      .from("profiles").select("id, role").eq("id", id).maybeSingle();
    if (!target) return fail("NOT_FOUND", 404);

    if (target.role === "admin") {
      const { count } = await admin
        .from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
      if ((count ?? 0) <= 1) return fail("LAST_ADMIN");
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) {
      console.error("deleteUser failed", delErr.message);
      return fail("DELETE_FAILED", 500);
    }
    return json({ id });
  }

  return fail("UNKNOWN_ACTION");
});
