import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type ChatMsg = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string };

const ALLOWED_MODELS = new Set([
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "google/gemini-3-flash-preview",
  "openai/gpt-5-mini",
  "openai/gpt-5",
]);

const SYSTEM_PROMPT = `You are the LSL Admin AI Copilot — a trusted super-admin assistant for the Lomita Shooters League betting platform.
You have full administrative tools: search/inspect users, credit or debit tokens, ban/unban, mute/unmute, kick, grant/revoke roles, adjust XP, refund bets, broadcast notifications, and read platform health (P&L, risk, pending queues).

Rules:
- Always identify the exact target user with search_users or get_user before performing a destructive or balance-changing action. Never guess a user_id.
- For token/XP/ban/mute/role/refund actions, only act when the admin's intent is clear. If ambiguous, ask a clarifying question instead of acting.
- Always include a clear human reason for moderation and token actions.
- After taking actions, briefly confirm what you did with concrete numbers (e.g. new balance).
- Be concise and professional. Format with short markdown when helpful.`;

// OpenAI-style tool schema exposed to the model.
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_users",
      description: "Search platform users by name, email, Discord username/full name, or gang. Returns up to 10 matches with id, balance, status.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Search text" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user",
      description: "Get full details for one user by id, including token balance, roles, ban/mute status, XP, and Discord info.",
      parameters: { type: "object", properties: { user_id: { type: "string" } }, required: ["user_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "adjust_tokens",
      description: "Credit (positive) or debit (negative) a user's token balance. Logs the change automatically.",
      parameters: { type: "object", properties: { user_id: { type: "string" }, amount: { type: "number", description: "Positive to credit, negative to debit" }, reason: { type: "string" } }, required: ["user_id", "amount", "reason"] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_ban",
      description: "Ban or unban a user.",
      parameters: { type: "object", properties: { user_id: { type: "string" }, banned: { type: "boolean" }, reason: { type: "string" } }, required: ["user_id", "banned"] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_mute",
      description: "Mute or unmute a user (blocks chat).",
      parameters: { type: "object", properties: { user_id: { type: "string" }, muted: { type: "boolean" }, reason: { type: "string" } }, required: ["user_id", "muted"] },
    },
  },
  {
    type: "function",
    function: {
      name: "kick_user",
      description: "Force-logout a user's active sessions.",
      parameters: { type: "object", properties: { user_id: { type: "string" }, reason: { type: "string" } }, required: ["user_id", "reason"] },
    },
  },
  {
    type: "function",
    function: {
      name: "adjust_xp",
      description: "Add or subtract XP for a user.",
      parameters: { type: "object", properties: { user_id: { type: "string" }, delta: { type: "number" }, reason: { type: "string" } }, required: ["user_id", "delta"] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_role",
      description: "Grant or revoke a platform role for a user.",
      parameters: { type: "object", properties: { user_id: { type: "string" }, role: { type: "string", enum: ["viewer", "shooter", "gang_leader", "registered", "sponsor", "moderator", "admin"] }, grant: { type: "boolean", description: "true to grant, false to revoke" } }, required: ["user_id", "role", "grant"] },
    },
  },
  {
    type: "function",
    function: {
      name: "refund_bet",
      description: "Refund a bet by its id (returns the stake to the user).",
      parameters: { type: "object", properties: { bet_id: { type: "string" }, reason: { type: "string" } }, required: ["bet_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "broadcast",
      description: "Send a notification to a segment of users. Segment: 'all', 'active', 'vip', or 'banned'.",
      parameters: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, link: { type: "string" }, segment: { type: "string" } }, required: ["title", "body"] },
    },
  },
  {
    type: "function",
    function: {
      name: "platform_health",
      description: "Get a platform health snapshot: user count, total circulating tokens, P&L and risk summaries, pending withdrawals and token requests.",
      parameters: { type: "object", properties: { days: { type: "number", description: "Window for P&L, default 30" } } },
    },
  },
] as const;

export const adminAiChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as { messages: { role: string; content: string }[]; model?: string })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    // Authorize: super-admin only.
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return { error: "Admin AI is restricted to super admins.", actions: [] };

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { error: "AI is not configured (missing API key).", actions: [] };

    const model = data.model && ALLOWED_MODELS.has(data.model) ? data.model : "google/gemini-2.5-flash";

    // Tool executors — run as the authenticated admin (RLS + auth.uid() apply).
    const exec: Record<string, (args: any) => Promise<any>> = {
      async search_users({ query }) {
        const q = String(query ?? "").trim();
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name, email, discord_username, discord_full_name, gang_name, token_balance, is_banned, is_muted, xp")
          .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,discord_username.ilike.%${q}%,discord_full_name.ilike.%${q}%,gang_name.ilike.%${q}%`)
          .limit(10);
        if (error) throw new Error(error.message);
        return { count: data?.length ?? 0, users: data ?? [] };
      },
      async get_user({ user_id }) {
        const { data: p, error } = await supabase.from("profiles").select("*").eq("id", user_id).maybeSingle();
        if (error) throw new Error(error.message);
        if (!p) throw new Error("User not found");
        const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user_id);
        return { ...p, roles: (roles ?? []).map((r: any) => r.role) };
      },
      async adjust_tokens({ user_id, amount, reason }) {
        const delta = Math.trunc(Number(amount));
        if (!delta) throw new Error("Amount must be a non-zero integer");
        const { data: p, error: e1 } = await supabase.from("profiles").select("token_balance, full_name").eq("id", user_id).maybeSingle();
        if (e1) throw new Error(e1.message);
        if (!p) throw new Error("User not found");
        const newBal = Number(p.token_balance ?? 0) + delta;
        if (newBal < 0) throw new Error("Balance cannot go negative");
        const { error } = await supabase.from("profiles").update({ token_balance: newBal }).eq("id", user_id);
        if (error) throw new Error(error.message);
        await supabase.from("notifications").insert({ user_id, title: delta > 0 ? "Tokens credited" : "Tokens debited", body: `${delta > 0 ? "+" : ""}${delta} tokens — ${reason ?? "admin adjustment"}` });
        await supabase.rpc("admin_log_action", { _action: delta > 0 ? "grant_tokens" : "revoke_tokens", _target_type: "user", _target_id: user_id, _metadata: { amount: delta, reason, balance_to: newBal, source: "admin_ai" } });
        return { user: p.full_name, delta, new_balance: newBal };
      },
      async set_ban({ user_id, banned, reason }) {
        const { error } = await supabase.from("profiles").update({ is_banned: !!banned, ban_reason: banned ? (reason ?? "Admin action") : null }).eq("id", user_id);
        if (error) throw new Error(error.message);
        await supabase.rpc("admin_log_action", { _action: banned ? "ban_user" : "unban_user", _target_type: "user", _target_id: user_id, _metadata: { reason, source: "admin_ai" } });
        return { user_id, banned: !!banned };
      },
      async set_mute({ user_id, muted, reason }) {
        const { error } = await supabase.from("profiles").update({ is_muted: !!muted, mute_reason: muted ? (reason ?? "Admin action") : null }).eq("id", user_id);
        if (error) throw new Error(error.message);
        await supabase.rpc("admin_log_action", { _action: muted ? "mute_user" : "unmute_user", _target_type: "user", _target_id: user_id, _metadata: { reason, source: "admin_ai" } });
        return { user_id, muted: !!muted };
      },
      async kick_user({ user_id, reason }) {
        const { error } = await supabase.rpc("admin_kick_user", { _user_id: user_id, _reason: reason ?? "Admin action" });
        if (error) throw new Error(error.message);
        return { user_id, kicked: true };
      },
      async adjust_xp({ user_id, delta, reason }) {
        const { error } = await supabase.rpc("admin_adjust_xp", { _user_id: user_id, _delta: Math.trunc(Number(delta)), _reason: reason ?? null });
        if (error) throw new Error(error.message);
        return { user_id, xp_delta: Math.trunc(Number(delta)) };
      },
      async set_role({ user_id, role, grant }) {
        if (grant) {
          const { error } = await supabase.from("user_roles").upsert({ user_id, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
          if (error) throw new Error(error.message);
        } else {
          const { error } = await supabase.from("user_roles").delete().eq("user_id", user_id).eq("role", role);
          if (error) throw new Error(error.message);
        }
        await supabase.rpc("admin_log_action", { _action: grant ? "add_role" : "remove_role", _target_type: "user", _target_id: user_id, _metadata: { role, source: "admin_ai" } });
        return { user_id, role, granted: !!grant };
      },
      async refund_bet({ bet_id, reason }) {
        const { error } = await supabase.rpc("admin_refund_bet", { _bet_id: bet_id, _reason: reason ?? null });
        if (error) throw new Error(error.message);
        return { bet_id, refunded: true };
      },
      async broadcast({ title, body, link, segment }) {
        const { error } = await supabase.rpc("admin_broadcast", { _title: title, _body: body, _link: link ?? null, _segment: segment ?? "all" });
        if (error) throw new Error(error.message);
        return { sent: true, segment: segment ?? "all" };
      },
      async platform_health({ days }) {
        const [{ count: userCount }, { data: balances }, { data: pnl }, { data: risk }, { count: pendW }, { count: pendT }] = await Promise.all([
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("profiles").select("token_balance"),
          supabase.rpc("admin_pnl_summary", { _days: Math.trunc(Number(days ?? 30)) }),
          supabase.rpc("admin_risk_summary"),
          supabase.from("withdrawal_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
          supabase.from("token_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
        ]);
        const circulating = (balances ?? []).reduce((a: number, x: any) => a + Number(x.token_balance ?? 0), 0);
        return { user_count: userCount ?? 0, circulating_tokens: circulating, pnl, risk, pending_withdrawals: pendW ?? 0, pending_token_requests: pendT ?? 0 };
      },
    };

    const convo: ChatMsg[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(data.messages ?? []).map((m) => ({ role: m.role as ChatMsg["role"], content: String(m.content ?? "") })),
    ];

    const actions: { name: string; args: any; result: any; error?: string }[] = [];

    try {
      for (let step = 0; step < 6; step++) {
        const res = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "X-Lovable-AIG-SDK": "raw",
          },
          body: JSON.stringify({ model, messages: convo, tools: TOOLS, tool_choice: "auto" }),
        });

        if (res.status === 429) return { error: "AI rate limit reached. Please wait a moment and try again.", actions };
        if (res.status === 402) return { error: "AI credits exhausted. Add credits in Settings → Workspace → Usage.", actions };
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          return { error: `AI request failed (${res.status}). ${t.slice(0, 200)}`, actions };
        }

        const json: any = await res.json();
        const msg = json?.choices?.[0]?.message;
        if (!msg) return { error: "AI returned an empty response.", actions };

        const toolCalls = msg.tool_calls ?? [];
        if (!toolCalls.length) {
          return { reply: msg.content ?? "(no reply)", actions };
        }

        // Record assistant turn with its tool calls, then execute each tool.
        convo.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
        for (const call of toolCalls) {
          const name = call.function?.name;
          let args: any = {};
          try { args = JSON.parse(call.function?.arguments || "{}"); } catch { args = {}; }
          const fn = exec[name];
          if (!fn) {
            actions.push({ name, args, result: null, error: "Unknown tool" });
            convo.push({ role: "tool", tool_call_id: call.id, name, content: JSON.stringify({ error: "Unknown tool" }) });
            continue;
          }
          try {
            const result = await fn(args);
            actions.push({ name, args, result });
            convo.push({ role: "tool", tool_call_id: call.id, name, content: JSON.stringify(result).slice(0, 4000) });
          } catch (e: any) {
            const error = e?.message ?? "Tool failed";
            actions.push({ name, args, result: null, error });
            convo.push({ role: "tool", tool_call_id: call.id, name, content: JSON.stringify({ error }) });
          }
        }
      }
      return { reply: "Reached the maximum number of tool steps. Please refine your request.", actions };
    } catch (e: any) {
      return { error: e?.message ?? "AI request failed", actions };
    }
  });
