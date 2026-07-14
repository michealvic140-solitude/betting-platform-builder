import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trophy, Calendar, Plus, X, Radio } from "lucide-react";

type Tournament = {
  id: string;
  name: string | null;
  starts_at: string | null;
  status: string | null;
  current_stage: string | null;
  stage_gap_seconds: number | null;
  bracket_size: number | null;
};

/**
 * Championship Virtual admin — toggle the arena open/closed and schedule
 * upcoming 16-team knockout tournaments. Live bracket execution runs from
 * the server; this panel just gates access and schedules matchups.
 */
export function ChampionshipAdminPanel() {
  const [enabled, setEnabled] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [gap, setGap] = useState(20);
  const [saving, setSaving] = useState(false);

  const sb = supabase as any;

  async function load() {
    const [{ data: s }, { data: ts }] = await Promise.all([
      sb.from("app_settings").select("virtual_championship_enabled").eq("id", 1).maybeSingle(),
      sb
        .from("tournaments")
        .select("id,name,starts_at,status,current_stage,stage_gap_seconds,bracket_size")
        .eq("kind", "championship_virtual")
        .order("starts_at", { ascending: false })
        .limit(20),
    ]);
    setEnabled(!!s?.virtual_championship_enabled);
    setTournaments((ts ?? []) as Tournament[]);
  }

  useEffect(() => { load(); }, []);

  async function toggleEnabled(v: boolean) {
    setEnabled(v);
    const { error } = await sb.from("app_settings").update({ virtual_championship_enabled: v }).eq("id", 1);
    if (error) { toast.error(error.message); return; }
    toast.success(v ? "Championship Virtual opened" : "Championship Virtual closed");
  }

  async function schedule() {
    if (!name.trim()) return toast.error("Name required");
    if (!startsAt) return toast.error("Pick a start time");
    setSaving(true);
    const { error } = await sb.from("tournaments").insert({
      name: name.trim(),
      kind: "championship_virtual",
      status: "scheduled",
      starts_at: new Date(startsAt).toISOString(),
      stage_gap_seconds: gap,
      bracket_size: 16,
      current_stage: "R16",
      is_featured: false,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Championship scheduled");
    setName(""); setStartsAt("");
    load();
  }

  async function cancel(id: string) {
    const { error } = await sb.from("tournaments").update({ status: "cancelled" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Cancelled"); load();
  }

  async function startNow(id: string) {
    const { error } = await sb.rpc("championship_start", { p_tournament: id });
    if (error) return toast.error(error.message);
    toast.success("Bracket drawn — tournament live");
    load();
  }

  return (
    <div className="space-y-4">
      <Card className="glass p-5 border-primary/30">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-gold grid place-items-center shadow-gold">
              <Trophy className="h-5 w-5 text-background" />
            </div>
            <div>
              <div className="font-black text-lg">Championship Virtual</div>
              <div className="text-xs text-muted-foreground">16-team knockout tournaments (R16 → QF → SF → Final)</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={enabled ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" : "border-muted/50 text-muted-foreground bg-muted/20"}>
              {enabled ? "Open" : "Closed"}
            </Badge>
            <Switch checked={enabled} onCheckedChange={toggleEnabled} />
          </div>
        </div>
      </Card>

      <Card className="glass p-5 border-primary/20">
        <div className="flex items-center gap-2 mb-3">
          <Plus className="h-4 w-4 text-primary" />
          <div className="font-black">Schedule new tournament</div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunday Night Knockout" />
          </div>
          <div>
            <Label>Starts at</Label>
            <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div>
            <Label>Gap between stages (s)</Label>
            <Input type="number" min={5} max={120} value={gap} onChange={(e) => setGap(Number(e.target.value) || 20)} />
          </div>
        </div>
        <Button className="btn-luxury mt-4" onClick={schedule} disabled={saving}>
          <Calendar className="h-4 w-4 mr-1" />{saving ? "Scheduling…" : "Schedule tournament"}
        </Button>
      </Card>

      <Card className="glass p-5 border-primary/20">
        <div className="font-black mb-3">Upcoming & recent</div>
        {tournaments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No championship tournaments yet.</p>
        ) : (
          <div className="space-y-2">
            {tournaments.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 p-3 rounded-md border border-border bg-background/40">
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{t.name}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                    <Calendar className="h-3 w-3" />
                    {t.starts_at ? new Date(t.starts_at).toLocaleString() : "—"}
                    <span className="opacity-40">·</span>
                    <span>gap {t.stage_gap_seconds ?? 20}s</span>
                    <span className="opacity-40">·</span>
                    <span>{t.bracket_size ?? 16} teams</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant="outline"
                    className={
                      t.status === "live"
                        ? "border-red-500/50 text-red-300 bg-red-500/10"
                        : t.status === "scheduled"
                          ? "border-amber-500/40 text-amber-300 bg-amber-500/10"
                          : t.status === "completed"
                            ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                            : "border-muted/50 text-muted-foreground"
                    }
                  >
                    {t.status === "live" ? <Radio className="h-3 w-3 mr-1 animate-pulse" /> : null}
                    {(t.status ?? "draft").toUpperCase()}
                  </Badge>
                  {t.status === "scheduled" && (
                    <Button variant="outline" size="sm" onClick={() => startNow(t.id)}>Start now</Button>
                  )}
                  {t.status !== "completed" && t.status !== "cancelled" && (
                    <Button variant="ghost" size="sm" onClick={() => cancel(t.id)}><X className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="glass p-4 border-amber-500/30 text-xs text-muted-foreground">
        <div className="font-bold text-amber-300 mb-1">Coming next build</div>
        Bracket assignment (drag 16 teams into slots), live shootout engine for each knockout match, per-round bracket board reveal during the {gap}s inter-stage gap, and Championship-specific betting markets (Outright winner, Reach stage, Eliminated at stage, Per-match winner).
      </Card>
    </div>
  );
}