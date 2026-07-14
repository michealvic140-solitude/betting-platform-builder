import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trophy, Loader2, CircleDot, Ticket, Radio, History, ChevronLeft, Plus, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { TeamLogo } from "@/components/TeamLogo";

// Per-user instant football shootouts. The user can queue MULTIPLE matchups
// (mirroring the Gang Instant experience), pick a side + stake for each, then
// hit "Play all bets" to run every shootout back to back — each getting its
// own bet voucher.

type FbTeam = { id: string; name: string; logo_url: string | null };
type KickResult = { home_kicks: boolean[]; away_kicks: boolean[]; home_score: number; away_score: number; result: "won"|"lost"; payout: number; bet_id?: string; tracking_id?: string };
type Pick = {
  key: string;
  home: FbTeam;
  away: FbTeam;
  side: "home"|"away";
  stake: number;
  result?: KickResult;
  kickIdx?: number;
};

function newPick(teams: FbTeam[]): Pick | null {
  if (teams.length < 2) return null;
  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    home: shuffled[0],
    away: shuffled[1],
    side: "home",
    stake: 100,
  };
}

export const Route = createFileRoute("/virtual/football-instant")({
  head: () => ({
    meta: [
      { title: "Instant E-Football — Per-User Shootouts" },
      { name: "description", content: "Queue multiple virtual football shootouts. Bet, shoot, settle — all private to you." },
    ],
  }),
  component: FootballInstantPage,
  errorComponent: ({ error }) => <Layout><div className="container py-12 text-center text-destructive">{error.message}</div></Layout>,
  notFoundComponent: () => <Layout><div className="container py-12 text-center text-muted-foreground">Not found.</div></Layout>,
});

function FootballInstantPage() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [teams, setTeams] = useState<FbTeam[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<Array<{ home: string; away: string; hs: number; as: number }>>([]);

  useEffect(() => {
    (async () => {
      const sb = supabase as any;
      const [{ data: s }, { data: t }, { data: hist }] = await Promise.all([
        sb.from("app_settings").select("virtual_football_instant_enabled").eq("id",1).maybeSingle(),
        sb.from("teams").select("id,name,logo_url").eq("sport","football").order("name"),
        sb.from("user_virtual_rounds").select("home_name,away_name,home_score,away_score").order("created_at",{ ascending: false }).limit(6),
      ]);
      setEnabled(!!s?.virtual_football_instant_enabled);
      setTeams((t ?? []) as FbTeam[]);
      setRecent(((hist ?? []) as any[]).map(r => ({ home: r.home_name, away: r.away_name, hs: r.home_score ?? 0, as: r.away_score ?? 0 })));
    })();
  }, []);

  useEffect(() => {
    if (teams.length >= 2 && picks.length === 0) {
      const p = newPick(teams);
      if (p) setPicks([p]);
    }
  }, [teams, picks.length]);

  function addPick() {
    const p = newPick(teams);
    if (!p) return;
    setPicks((prev) => [...prev, p]);
  }
  function removePick(key: string) {
    setPicks((prev) => prev.filter((p) => p.key !== key));
  }
  function updatePick(key: string, patch: Partial<Pick>) {
    setPicks((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }
  function redrawPick(key: string) {
    const p = newPick(teams);
    if (!p) return;
    setPicks((prev) => prev.map((it) => (it.key === key ? { ...p, key, stake: it.stake, side: it.side } : it)));
  }

  async function playAll() {
    if (!user) return toast.error("Sign in to play");
    const pending = picks.filter((p) => !p.result);
    if (pending.length === 0) return;
    if (pending.some((p) => p.stake <= 0)) return toast.error("Every stake must be positive");
    setBusy(true);
    let wins = 0, losses = 0, totalPayout = 0;
    for (const pick of pending) {
      const { data, error } = await (supabase as any).rpc("start_user_virtual_round", {
        p_home: pick.home.name, p_away: pick.away.name, p_side: pick.side, p_stake: pick.stake,
      });
      if (error) { toast.error(`${pick.home.name} vs ${pick.away.name}: ${error.message}`); continue; }
      const r = data as KickResult;
      updatePick(pick.key, { result: r, kickIdx: -1 });
      // animate kicks for this pick
      const total = Math.max(r.home_kicks.length, r.away_kicks.length);
      await new Promise<void>((resolve) => {
        let i = 0;
        const timer = setInterval(() => {
          setPicks((prev) => prev.map((it) => it.key === pick.key ? { ...it, kickIdx: i } : it));
          i++;
          if (i >= total) { clearInterval(timer); resolve(); }
        }, 350);
      });
      if (r.result === "won") { wins++; totalPayout += r.payout; } else losses++;
    }
    setBusy(false);
    if (wins) toast.success(`${wins} win${wins>1?"s":""} · +${totalPayout.toLocaleString()} ECB`);
    if (losses && !wins) toast.error(`${losses} loss${losses>1?"es":""}`);
  }

  function resetAll() {
    if (teams.length < 2) return;
    setPicks([newPick(teams)!]);
  }

  const anyPending = picks.some((p) => !p.result);
  const allSettled = picks.length > 0 && picks.every((p) => !!p.result);

  return (
    <Layout>
      <div className="virtual-page min-h-[calc(100vh-4rem)]">
        <div className="container py-4 sm:py-6 space-y-4 max-w-3xl">
          <Card className="virtual-panel px-4 py-3">
            <div className="flex items-center justify-between">
              <Link to="/virtual" className="text-muted-foreground hover:text-foreground">
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <div className="text-center">
                <div className="text-sm sm:text-base font-black tracking-wide gradient-gold-text">Instant E-Football</div>
                <div className="flex items-center justify-center gap-2 mt-0.5">
                  <span className="text-[11px] text-muted-foreground font-mono">Multi-match shoot-outs · 1.90x</span>
                  <Badge variant="outline" className="border-emerald-500/50 bg-emerald-500/10 text-emerald-300 uppercase tracking-widest text-[9px] font-black">
                    <Trophy className="h-3 w-3 mr-1"/> LIVE
                  </Badge>
                </div>
              </div>
              <Link to="/virtual/history" className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[10px] uppercase tracking-widest">
                <History className="h-3.5 w-3.5" /> Rounds
              </Link>
            </div>
          </Card>

          <Card className="virtual-panel px-3 py-2 flex items-center gap-2 text-[11px]">
            <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
            <span className="font-black uppercase tracking-widest text-emerald-300">Play as you stake</span>
            <span className="text-muted-foreground">— queue as many matchups as you like, then hit Play all.</span>
          </Card>

          {!enabled ? (
            <Card className="virtual-panel p-10 text-center text-muted-foreground">Instant E-Football is currently closed.</Card>
          ) : teams.length < 2 ? (
            <Card className="virtual-panel p-10 text-center text-muted-foreground">
              Not enough football-tagged teams yet. Admins can tag teams as football from Clans admin.
            </Card>
          ) : (
            <>
            {picks.map((p, idx) => (
              <MatchupCard
                key={p.key}
                pick={p}
                index={idx}
                busy={busy}
                onSide={(side) => updatePick(p.key, { side })}
                onStake={(stake) => updatePick(p.key, { stake })}
                onRedraw={() => redrawPick(p.key)}
                onRemove={picks.length > 1 && !p.result ? () => removePick(p.key) : undefined}
              />
            ))}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={addPick} disabled={busy || teams.length < 2}>
                <Plus className="h-4 w-4 mr-1" /> Add another match
              </Button>
              {allSettled ? (
                <Button className="btn-luxury" onClick={resetAll} disabled={busy}>New round</Button>
              ) : (
                <Button className="btn-luxury" onClick={playAll} disabled={busy || !user || !anyPending}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1"/> : <CircleDot className="h-4 w-4 mr-1"/>}
                  Play all bets ({picks.filter((p)=>!p.result).length})
                </Button>
              )}
            </div>

            {/* Previous scores */}
            <Card className="virtual-panel p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/80 mb-2">
                Previous scores
              </div>
              <div className="space-y-1.5">
                {recent.length === 0 && <div className="text-[11px] text-muted-foreground">No history yet.</div>}
                {recent.slice(0, 5).map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <div className="min-w-0 leading-tight">
                      <div className="truncate">{r.home}</div>
                      <div className="truncate text-muted-foreground">{r.away}</div>
                    </div>
                    <div className="font-mono font-black text-primary tabular-nums shrink-0">{r.hs}:{r.as}</div>
                  </div>
                ))}
              </div>
            </Card>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

function MatchupCard({
  pick, index, busy, onSide, onStake, onRedraw, onRemove,
}: {
  pick: Pick;
  index: number;
  busy: boolean;
  onSide: (s: "home"|"away") => void;
  onStake: (n: number) => void;
  onRedraw: () => void;
  onRemove?: () => void;
}) {
  const { home, away, side, stake, result, kickIdx = -1 } = pick;
  return (
    <Card className="virtual-panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/80">Match {index + 1}</div>
        <div className="flex items-center gap-1">
          {!result && <Button variant="ghost" size="sm" onClick={onRedraw} disabled={busy}>Redraw</Button>}
          {onRemove && !result && (
            <Button variant="ghost" size="icon" onClick={onRemove} disabled={busy} className="h-7 w-7"><X className="h-3.5 w-3.5"/></Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 items-center gap-2">
        <button onClick={() => onSide("home")} disabled={!!result || busy} className={`p-2 rounded-lg border transition ${side==="home"?"border-primary bg-primary/10":"border-border"} disabled:opacity-60`}>
          <TeamLogo name={home.name} url={home.logo_url} size={44} rounded="full" />
          <div className="font-bold text-xs mt-1 truncate">{home.name}</div>
          <div className="text-[10px] text-muted-foreground">Home · 1.90x</div>
        </button>
        <div className="text-center font-black text-xl gradient-gold-text">
          {result ? `${result.home_score} : ${result.away_score}` : "VS"}
        </div>
        <button onClick={() => onSide("away")} disabled={!!result || busy} className={`p-2 rounded-lg border transition ${side==="away"?"border-primary bg-primary/10":"border-border"} disabled:opacity-60`}>
          <TeamLogo name={away.name} url={away.logo_url} size={44} rounded="full" />
          <div className="font-bold text-xs mt-1 truncate">{away.name}</div>
          <div className="text-[10px] text-muted-foreground">Away · 1.90x</div>
        </button>
      </div>

      {!result ? (
        <div>
          <Label className="text-[10px] uppercase tracking-widest">Stake (ECB)</Label>
          <Input type="number" min={1} value={stake} onChange={(e) => onStake(Number(e.target.value)||0)} disabled={busy}/>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <div className="font-bold text-[10px] uppercase tracking-widest text-muted-foreground">{home.name}</div>
              <div className="flex flex-wrap gap-1">{result.home_kicks.map((k,i) => (
                <span key={i} className={`h-6 w-6 rounded-full grid place-items-center text-[10px] font-bold ${i>kickIdx?"bg-muted/30 text-muted-foreground":k?"bg-emerald-500/30 text-emerald-300":"bg-red-500/30 text-red-300"}`}>{i>kickIdx?"·":k?"✓":"✗"}</span>
              ))}</div>
            </div>
            <div className="space-y-1">
              <div className="font-bold text-[10px] uppercase tracking-widest text-muted-foreground">{away.name}</div>
              <div className="flex flex-wrap gap-1">{result.away_kicks.map((k,i) => (
                <span key={i} className={`h-6 w-6 rounded-full grid place-items-center text-[10px] font-bold ${i>kickIdx?"bg-muted/30 text-muted-foreground":k?"bg-emerald-500/30 text-emerald-300":"bg-red-500/30 text-red-300"}`}>{i>kickIdx?"·":k?"✓":"✗"}</span>
              ))}</div>
            </div>
          </div>
          <div className={`text-center font-black text-sm ${result.result==="won"?"text-emerald-400":"text-destructive"}`}>
            {result.result === "won" ? `WON · +${result.payout.toLocaleString()} ECB` : "LOST"}
          </div>
          {result.bet_id && (
            <Link to="/ticket/$id" params={{ id: result.bet_id }}>
              <Button variant="outline" className="w-full gap-2" size="sm"><Ticket className="h-3.5 w-3.5"/>View voucher{result.tracking_id?` · ${result.tracking_id}`:""}</Button>
            </Link>
          )}
        </>
      )}
    </Card>
  );
}
        <span className="truncate max-w-[35%] text-red-200 drop-shadow">{nameA}</span>
        <span className="text-amber-300 tabular-nums text-lg drop-shadow">{scoreA} – {scoreB}</span>
        <span className="truncate max-w-[35%] text-sky-200 text-right drop-shadow">{nameB}</span>
      </div>
      {live && <div className="absolute top-1 left-1 text-[9px] uppercase tracking-widest bg-emerald-500/40 text-emerald-100 px-1.5 rounded">⚽ LIVE</div>}
    </div>
  );
}