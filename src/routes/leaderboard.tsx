import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy } from "lucide-react";
import { loadStandings, type LbRow } from "@/lib/leaderboard";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Leaderboard — Lomita Shooters League" },
      { name: "description", content: "See the top shooters and top gangs ranked by total score, season points, wins, and tokens won across the Lomita Shooters League." },
      { property: "og:title", content: "LSL Leaderboard — Top Shooters & Gangs" },
      { property: "og:description", content: "Top shooters and gangs ranked by total score, season points, wins, and tokens won." },
      { property: "og:url", content: "https://lslonlinebetting.lovable.app/leaderboard" },
    ],
    links: [{ rel: "canonical", href: "https://lslonlinebetting.lovable.app/leaderboard" }],
    scripts: [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "LSL Leaderboard",
        description: "Top shooters and gangs in the Lomita Shooters League.",
        url: "https://lslonlinebetting.lovable.app/leaderboard",
      }),
    }],
  }),
  component: Page,
});

function Medal({ i }: { i: number }) {
  const tiers = ["from-amber-300 to-yellow-600", "from-slate-200 to-slate-400", "from-amber-600 to-orange-800"];
  if (i < 3) {
    return (
      <span className={`inline-grid place-items-center h-8 w-8 rounded-lg bg-gradient-to-b ${tiers[i]} text-black font-black text-sm shadow-[0_0_14px_-2px_rgba(212,175,55,0.6)] border border-white/30`}>
        {i + 1}
      </span>
    );
  }
  return <span className="text-sm font-bold text-muted-foreground tabular-nums">{i + 1}</span>;
}

function Page() {
  const [shooters, setShooters] = useState<LbRow[]>([]);
  const [gangs, setGangs] = useState<LbRow[]>([]);

  useEffect(() => {
    const run = async () => {
      const { gangs, shooters } = await loadStandings();
      setGangs(gangs);
      setShooters(shooters);
    };
    run();
    const ch = supabase
      .channel("leaderboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "leaderboard_overrides" }, run)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, run)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <Layout>
      <div className="container py-8 max-w-5xl">
        <div className="relative mb-6 rounded-2xl overflow-hidden glass-ice border border-primary/30">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/10 to-transparent" />
          <div className="relative flex items-center gap-3 px-5 py-5">
            <span className="grid place-items-center h-12 w-12 rounded-xl border border-amber-400/40 bg-black/40 shadow-[0_0_20px_-4px_rgba(212,175,55,0.6)]">
              <Trophy className="h-6 w-6 text-amber-300" />
            </span>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight gradient-gold-text drop-shadow-[0_2px_8px_rgba(212,175,55,0.3)]">LEADERBOARD</h1>
          </div>
        </div>

        <Tabs defaultValue="gangs">
          <TabsList className="bg-card/40 backdrop-blur-xl border border-primary/20">
            <TabsTrigger value="gangs">Top Gangs / Factions</TabsTrigger>
            <TabsTrigger value="shooters">Top Shooters</TabsTrigger>
          </TabsList>

          <TabsContent value="gangs" className="mt-4">
            <Board rows={gangs} firstCol="Gang / Faction" secondCol="Top Player" pick={(g) => g.top_player || "—"} emptyText="No data yet." />
          </TabsContent>

          <TabsContent value="shooters" className="mt-4">
            <Board rows={shooters} firstCol="Gang & Faction" secondCol="Player" pick={(p) => p.name} firstPick={(p) => p.gang_faction || "—"} emptyText="No shooters yet." />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function Board({
  rows, firstCol, secondCol, pick, firstPick, emptyText,
}: {
  rows: LbRow[];
  firstCol: string;
  secondCol: string;
  pick: (r: LbRow) => string;
  firstPick?: (r: LbRow) => string;
  emptyText: string;
}) {
  return (
    <div className="relative rounded-2xl overflow-hidden glass-ice border border-primary/20">
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-amber-200/80 border-b border-amber-400/25 bg-white/5">
              <Th>Rank</Th><Th>{firstCol}</Th><Th>{secondCol}</Th>
              <Th right>TS</Th><Th right>W</Th><Th right>L</Th><Th right>D</Th><Th right>P</Th><Th right>PTS</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">{emptyText}</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.name} className="glass-ice-row border-b border-white/5 hover:bg-amber-400/10 transition-colors">
                <Td><Medal i={i} /></Td>
                <Td>{firstPick ? <span className="font-bold text-primary/90">{firstPick(r)}</span> : <span className="font-bold">{pick(r)}</span>}</Td>
                <Td><span className={firstPick ? "font-bold" : "text-muted-foreground"}>{firstPick ? pick(r) : (r.top_player || "—")}</span></Td>
                <Td right><Pill tone="amber">{r.TS}</Pill></Td>
                <Td right><span className="text-emerald-400 font-bold">{r.W}</span></Td>
                <Td right><span className="text-destructive font-bold">{r.L}</span></Td>
                <Td right><span className="text-amber-400 font-bold">{r.D}</span></Td>
                <Td right><span className="text-muted-foreground">{r.P}</span></Td>
                <Td right><Pill tone="emerald">{r.PTS}</Pill></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "amber" | "emerald" }) {
  const cls = tone === "amber"
    ? "border-amber-400/40 text-amber-200 bg-amber-400/10"
    : "border-emerald-400/40 text-emerald-300 bg-emerald-400/10";
  return <span className={`inline-grid place-items-center min-w-[40px] rounded-md border px-2 py-1 font-black tabular-nums ${cls}`}>{children}</span>;
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) { return <th className={`px-4 py-3 ${right ? "text-right" : ""}`}>{children}</th>; }
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) { return <td className={`px-4 py-3 ${right ? "text-right" : ""}`}>{children}</td>; }
