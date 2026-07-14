import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { PageShell } from "@/components/PageShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Crosshair, Trophy, ArrowRight, Radio, Users, History } from "lucide-react";

export const Route = createFileRoute("/virtual")({
  head: () => ({
    meta: [
      { title: "Virtual Matches — Instant & Championship | LSL" },
      {
        name: "description",
        content:
          "Choose your virtual arena: Instant Virtual for quick shootouts, or Championship Virtual for scheduled 16-team knockout tournaments.",
      },
    ],
  }),
  component: VirtualHubPage,
});

type Flags = {
  virtual_cycle_running?: boolean | null;
  virtual_championship_enabled?: boolean | null;
};

function VirtualHubPage() {
  const [flags, setFlags] = useState<Flags>({});
  const [liveInstant, setLiveInstant] = useState(0);
  const [nextChamp, setNextChamp] = useState<{ starts_at: string | null; status: string | null } | null>(null);

  useEffect(() => {
    (async () => {
      const sb = supabase as any;
      const [{ data: s }, { count: liveCount }, { data: t }] = await Promise.all([
        sb
          .from("app_settings")
          .select("virtual_cycle_running,virtual_championship_enabled")
          .eq("id", 1)
          .maybeSingle(),
        sb
          .from("matches")
          .select("id", { count: "exact", head: true })
          .eq("is_virtual", true)
          .eq("status", "live"),
        sb
          .from("tournaments")
          .select("starts_at,status")
          .eq("kind", "championship_virtual")
          .in("status", ["scheduled", "live"])
          .order("starts_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      setFlags((s ?? {}) as Flags);
      setLiveInstant(liveCount ?? 0);
      setNextChamp((t ?? null) as any);
    })();
  }, []);

  const instantOpen = !!flags.virtual_cycle_running;
  const champOpen = !!flags.virtual_championship_enabled;

  return (
    <Layout>
      <PageShell tone="default">
        <div className="container py-8 sm:py-12 space-y-8">
          <header className="text-center max-w-2xl mx-auto">
            <Badge variant="outline" className="border-primary/40 text-primary bg-primary/10 mb-3 uppercase tracking-[0.3em] text-[10px]">
              LSL Virtual Arenas
            </Badge>
            <h1 className="font-display text-4xl sm:text-5xl font-black gradient-gold-text leading-tight">
              Pick your battlefield
            </h1>
            <p className="text-muted-foreground mt-3 text-sm sm:text-base">
              Two virtual formats. Same adrenaline. Choose the arena that fits your mood.
            </p>
          </header>

          <div className="grid gap-6 md:grid-cols-2 max-w-5xl mx-auto">
            <ArenaCard
              to="/virtual/instant"
              accent="from-red-500/40 via-red-600/10"
              icon={<Crosshair className="h-8 w-8" />}
              tag="Instant Virtual"
              title="Instant Shootouts"
              description="Fast gang vs gang shootouts. Place your bet, hit start, and watch the animation unfold. No waiting, no schedule — you control when it begins."
              live={liveInstant}
              open={instantOpen}
              closedLabel="Closed by admin"
              cta="Enter arena"
            />
            <ArenaCard
              to="/virtual/championship"
              accent="from-amber-500/40 via-amber-600/10"
              icon={<Trophy className="h-8 w-8" />}
              tag="Championship Virtual"
              title="Knockout Tournament"
              description="16 gangs. 4 knockout rounds. Bet on champions, quarter/semi/final reachers, per-match winners, and specific stage eliminations. Auto-scheduled by the house."
              live={nextChamp?.status === "live" ? 1 : 0}
              open={champOpen}
              closedLabel="Closed by admin"
              cta="View bracket"
              extra={
                nextChamp?.starts_at ? (
                  <span className="text-[11px] uppercase tracking-[0.25em] text-amber-300">
                    Next: {new Date(nextChamp.starts_at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                ) : null
              }
            />
          </div>

          <div className="text-center">
            <Link
              to="/virtual/history"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-muted-foreground hover:text-primary transition"
            >
              <History className="h-3.5 w-3.5" />
              Rounds history
            </Link>
          </div>
        </div>
      </PageShell>
    </Layout>
  );
}

function ArenaCard({
  to,
  accent,
  icon,
  tag,
  title,
  description,
  live,
  open,
  closedLabel,
  cta,
  extra,
}: {
  to: "/virtual/instant" | "/virtual/championship";
  accent: string;
  icon: React.ReactNode;
  tag: string;
  title: string;
  description: string;
  live: number;
  open: boolean;
  closedLabel: string;
  cta: string;
  extra?: React.ReactNode;
}) {
  return (
    <Link to={to} className="group">
      <Card className="relative overflow-hidden h-full glass border-primary/30 p-7 transition-all duration-300 group-hover:border-primary/60 group-hover:-translate-y-1 group-hover:shadow-luxury">
        {/* Ambient gradient */}
        <div className={`pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-gradient-to-br ${accent} to-transparent blur-3xl opacity-70`} />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-gold opacity-70" />

        <div className="relative flex items-start justify-between gap-3">
          <div className="h-14 w-14 rounded-2xl bg-background/40 border border-primary/30 backdrop-blur-xl grid place-items-center text-primary shadow-inner">
            {icon}
          </div>
          {open ? (
            live > 0 ? (
              <Badge variant="outline" className="border-red-500/50 text-red-300 bg-red-500/15 uppercase tracking-widest text-[10px] flex items-center gap-1">
                <Radio className="h-3 w-3 animate-pulse" /> Live
              </Badge>
            ) : (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 bg-emerald-500/10 uppercase tracking-widest text-[10px]">
                Open
              </Badge>
            )
          ) : (
            <Badge variant="outline" className="border-muted/50 text-muted-foreground bg-muted/20 uppercase tracking-widest text-[10px]">
              {closedLabel}
            </Badge>
          )}
        </div>

        <div className="relative mt-6 space-y-2">
          <div className="text-[10px] uppercase tracking-[0.35em] text-primary/80 font-black">{tag}</div>
          <h2 className="font-display text-2xl sm:text-3xl font-black leading-tight">{title}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
          {extra && <div className="pt-1">{extra}</div>}
        </div>

        <div className="relative mt-6 flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>{live > 0 ? `${live} live` : "Waiting"}</span>
          </div>
          <span className="inline-flex items-center gap-2 text-sm font-black text-primary group-hover:gap-3 transition-all">
            {cta} <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </Card>
    </Link>
  );
}