import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { PageShell } from "@/components/PageShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Trophy, Clock, Radio, Sparkles } from "lucide-react";
import { BracketBoard } from "@/components/BracketBoard";
import { ChampionshipBetPanel } from "@/components/ChampionshipBetPanel";
import { ChampionshipLiveFeed } from "@/components/ChampionshipLiveFeed";

export const Route = createFileRoute("/virtual/championship")({
  head: () => ({
    meta: [
      { title: "Championship Virtual — 16-team Knockout | LSL" },
      { name: "description", content: "16-team virtual knockout tournament. Bet on champions, stage reachers, and per-match winners." },
    ],
  }),
  component: ChampionshipPage,
});

type Tournament = {
  id: string; name: string | null; starts_at: string | null; status: string | null;
  current_stage: string | null; next_stage_at: string | null; team_ids: string[] | null;
  champion_team_id: string | null;
};

function ChampionshipPage() {
  const [enabled, setEnabled] = useState(true);
  const [active, setActive] = useState<Tournament | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const load = async () => {
      const sb = supabase as any;
      // Heartbeat: advance the engine if a stage is due (RPC is idempotent and no-op when not due).
      try { await sb.rpc("championship_tick"); } catch { /* noop */ }
      const { data: s } = await sb.from("app_settings").select("virtual_championship_enabled").eq("id", 1).maybeSingle();
      setEnabled(!!s?.virtual_championship_enabled);
      const { data: t } = await sb
        .from("tournaments")
        .select("id,name,starts_at,status,current_stage,next_stage_at,team_ids,champion_team_id")
        .eq("kind", "championship_virtual")
        .in("status", ["scheduled", "live", "completed"])
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setActive((t ?? null) as Tournament | null);
    };
    load();
    const t = setInterval(load, 5_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, []);

  const targetAt = active?.status === "live"
    ? (active?.next_stage_at ? new Date(active.next_stage_at).getTime() : null)
    : (active?.starts_at ? new Date(active.starts_at).getTime() : null);
  const cd = targetAt ? Math.max(0, Math.floor((targetAt - now) / 1000)) : null;
  const mm = cd != null ? String(Math.floor(cd / 60)).padStart(2, "0") : "--";
  const ss = cd != null ? String(cd % 60).padStart(2, "0") : "--";

  return (
    <Layout>
      <PageShell tone="default">
        <div className="container py-6 sm:py-10 space-y-6 max-w-6xl">
          <div className="flex items-center justify-between">
            <Link to="/virtual"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
            <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-300 uppercase tracking-widest text-[10px]">
              <Trophy className="h-3 w-3 mr-1" /> Championship Virtual
            </Badge>
            <div className="w-12" />
          </div>

          <header className="text-center max-w-2xl mx-auto">
            <h1 className="font-display text-3xl sm:text-5xl font-black gradient-gold-text leading-tight">
              16-Team Knockout
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Round of 16 → Quarters → Semis → Final. Bracket auto-advances between stages.
            </p>
          </header>

          {!enabled ? (
            <Card className="glass p-10 text-center text-muted-foreground border-primary/30">
              <Trophy className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-semibold">Championship Virtual is currently closed.</p>
            </Card>
          ) : !active ? (
            <Card className="glass p-10 text-center text-muted-foreground border-primary/30">
              <Sparkles className="h-10 w-10 mx-auto mb-3 text-primary/50" />
              <p className="font-semibold">No championship scheduled right now.</p>
            </Card>
          ) : active.status === "scheduled" ? (
            <Card className="glass p-8 border-primary/30 text-center">
              <div className="text-[10px] uppercase tracking-[0.35em] text-amber-300 mb-2">Next tournament kicks off in</div>
              <div className="text-6xl sm:text-7xl font-black gradient-gold-text tabular-nums leading-none">{mm}:{ss}</div>
              <div className="text-xs text-muted-foreground mt-3 flex items-center justify-center gap-1">
                <Clock className="h-3 w-3" /> {active.starts_at ? new Date(active.starts_at).toLocaleString() : ""}
              </div>
              <div className="mt-6 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                Lock your picks in: outright champion, stage reachers (Final / Semi / Quarter), per-match winners, and stage eliminations.
              </div>
            </Card>
          ) : active.status === "completed" ? (
            <Card className="glass p-6 border-primary/30 space-y-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 text-amber-300 mb-2">
                  <Trophy className="h-5 w-5" />
                  <span className="font-black uppercase tracking-widest">Champion crowned</span>
                </div>
                <div className="font-display text-2xl font-black">{active.name}</div>
              </div>
              <BracketBoard tournamentId={active.id} currentStage={active.current_stage} />
              <ChampionshipLiveFeed tournamentId={active.id} sport="generic" />
            </Card>
          ) : (
            <Card className="glass p-6 border-primary/30 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-destructive">
                  <Radio className="h-5 w-5 animate-pulse" />
                  <span className="font-black uppercase tracking-widest text-sm">Tournament live</span>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Next stage in</div>
                  <div className="text-3xl font-black tabular-nums gradient-gold-text leading-none">{mm}:{ss}</div>
                </div>
              </div>
              <div className="text-center">
                <div className="font-display text-2xl font-black">{active.name ?? "Championship"}</div>
                <p className="text-xs text-muted-foreground mt-1">Current stage: {active.current_stage ?? "R16"}</p>
              </div>
              <BracketBoard tournamentId={active.id} currentStage={active.current_stage} />
              <ChampionshipLiveFeed tournamentId={active.id} sport="generic" />
            </Card>
          )}

          {active && (active.status === "live" || active.status === "scheduled") && (active.team_ids?.length ?? 0) > 0 && (
            <ChampionshipBetPanel
              tournamentId={active.id}
              teamIds={active.team_ids ?? []}
              currentStage={active.current_stage}
            />
          )}
        </div>
      </PageShell>
    </Layout>
  );
}