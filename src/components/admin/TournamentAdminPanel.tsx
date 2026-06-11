import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Trophy, Plus, Trash2, Crown, Swords, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/ConfirmDialog";
import { TournamentBracket, type TMatch, type TParticipant, type Tournament } from "@/components/TournamentBracket";

function labelFor(matchesInRound: number, j: number) {
  if (matchesInRound === 1) return "FINAL";
  if (matchesInRound === 2) return `SF${j + 1}`;
  if (matchesInRound === 4) return `QF${j + 1}`;
  if (matchesInRound === 8) return `R16-${j + 1}`;
  return `M${j + 1}`;
}
function roundNameFor(playersInRound: number) {
  if (playersInRound <= 2) return "Grand Final";
  if (playersInRound <= 4) return "Semifinals";
  if (playersInRound <= 8) return "Quarterfinals";
  if (playersInRound <= 16) return "Round of 16";
  return `Round of ${playersInRound}`;
}

export function TournamentAdminPanel() {
  const confirm = useConfirm();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<TParticipant[]>([]);
  const [matches, setMatches] = useState<TMatch[]>([]);
  const [futureMatches, setFutureMatches] = useState<any[]>([]);

  // create form
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("ONE LEAGUE. NO MERCY. RESPECT THE GAME.");
  const [eventDate, setEventDate] = useState("");
  const [pName, setPName] = useState("");
  const [pLogo, setPLogo] = useState("");

  // result dialog
  const [resultMatch, setResultMatch] = useState<TMatch | null>(null);
  const [sA, setSA] = useState("");
  const [sB, setSB] = useState("");

  const sel = useMemo(() => tournaments.find((t) => t.id === selId) ?? null, [tournaments, selId]);
  const partMap = useMemo(() => Object.fromEntries(participants.map((p) => [p.id, p])), [participants]);

  async function loadTournaments() {
    const { data } = await (supabase as any).from("tournaments").select("*").order("created_at", { ascending: false });
    setTournaments(data ?? []);
    if (!selId && data?.length) setSelId(data[0].id);
    const { data: fm } = await (supabase as any).from("matches").select("id,name").eq("match_kind", "future").eq("is_archived", false).order("created_at", { ascending: false });
    setFutureMatches(fm ?? []);
  }
  async function loadDetail(id: string) {
    const [{ data: ps }, { data: ms }] = await Promise.all([
      (supabase as any).from("tournament_participants").select("*").eq("tournament_id", id).order("seed").order("created_at"),
      (supabase as any).from("tournament_matches").select("*").eq("tournament_id", id).order("round").order("slot"),
    ]);
    setParticipants(ps ?? []);
    setMatches(ms ?? []);
  }
  useEffect(() => { loadTournaments(); }, []);
  useEffect(() => { if (selId) loadDetail(selId); }, [selId]);

  async function createTournament() {
    if (!name.trim()) { toast.error("Enter a tournament name"); return; }
    const { data, error } = await (supabase as any).from("tournaments").insert({
      name: name.trim(), tagline: tagline.trim() || null, event_date: eventDate || null, status: "active", is_featured: true,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    setName(""); setEventDate("");
    await loadTournaments();
    setSelId(data.id);
    toast.success("Tournament created — now add participants");
  }

  async function addParticipant() {
    if (!sel) return;
    if (!pName.trim()) { toast.error("Enter participant name"); return; }
    const { error } = await (supabase as any).from("tournament_participants").insert({
      tournament_id: sel.id, name: pName.trim(), logo_url: pLogo.trim() || null, seed: participants.length + 1,
    });
    if (error) { toast.error(error.message); return; }
    setPName(""); setPLogo("");
    loadDetail(sel.id);
  }
  async function removeParticipant(id: string) {
    if (!sel) return;
    await (supabase as any).from("tournament_participants").delete().eq("id", id);
    loadDetail(sel.id);
  }

  async function generateBracket() {
    if (!sel) return;
    if (participants.length < 2) { toast.error("Add at least 2 participants"); return; }
    const ok = await confirm({
      title: "Generate the knockout bracket?",
      description: `This builds a single-elimination bracket for ${participants.length} participant${participants.length === 1 ? "" : "s"}. Any existing bracket matches for this tournament will be replaced. Empty slots become byes you can resolve manually.`,
      confirmText: "Generate bracket",
    });
    if (!ok) return;

    await (supabase as any).from("tournament_matches").delete().eq("tournament_id", sel.id);

    let size = 2;
    while (size < participants.length) size *= 2;
    const totalRounds = Math.log2(size);

    // build from final round down so we know next_match ids
    let aboveIds: string[] = [];
    for (let r = totalRounds; r >= 1; r--) {
      const matchesInRound = size / Math.pow(2, r);
      const rows = Array.from({ length: matchesInRound }, (_, j) => {
        const next_match_id = r === totalRounds ? null : aboveIds[Math.floor(j / 2)] ?? null;
        const next_slot = r === totalRounds ? null : j % 2 === 0 ? "a" : "b";
        const row: any = {
          tournament_id: sel.id, round: r, slot: j,
          label: labelFor(matchesInRound, j), round_name: roundNameFor(matchesInRound * 2),
          next_match_id, next_slot, status: "pending",
        };
        if (r === 1) {
          row.participant_a_id = participants[2 * j]?.id ?? null;
          row.participant_b_id = participants[2 * j + 1]?.id ?? null;
        }
        return row;
      });
      const { data, error } = await (supabase as any).from("tournament_matches").insert(rows).select("id,slot");
      if (error) { toast.error(error.message); return; }
      aboveIds = (data ?? []).sort((a: any, b: any) => a.slot - b.slot).map((d: any) => d.id);
    }
    toast.success("Bracket generated");
    loadDetail(sel.id);
  }

  async function linkFutures(matchId: string) {
    if (!sel) return;
    await (supabase as any).from("tournaments").update({ futures_match_id: matchId || null }).eq("id", sel.id);
    loadTournaments();
    toast.success(matchId ? "Linked futures market for betting" : "Unlinked betting market");
  }

  async function deleteTournament() {
    if (!sel) return;
    const ok = await confirm({ title: "Delete this tournament?", description: "The whole bracket, participants and results will be permanently removed.", tone: "danger", confirmText: "Delete tournament" });
    if (!ok) return;
    await (supabase as any).from("tournaments").delete().eq("id", sel.id);
    setSelId(null);
    loadTournaments();
  }

  function openResult(m: TMatch) {
    if (!m.participant_a_id && !m.participant_b_id) { toast.info("Both slots are empty — winners from the previous round will appear here."); return; }
    setResultMatch(m);
    setSA(m.score_a != null ? String(m.score_a) : "");
    setSB(m.score_b != null ? String(m.score_b) : "");
  }
  async function submitResult(winnerId: string | null) {
    if (!resultMatch) return;
    const { error } = await (supabase as any).rpc("set_tournament_result", {
      _match_id: resultMatch.id,
      _score_a: sA === "" ? null : Number(sA),
      _score_b: sB === "" ? null : Number(sB),
      _winner_id: winnerId,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(winnerId ? "Result saved — winner advanced" : "Scores saved");
    setResultMatch(null);
    loadDetail(sel!.id);
  }

  const rA = resultMatch?.participant_a_id ? partMap[resultMatch.participant_a_id] : null;
  const rB = resultMatch?.participant_b_id ? partMap[resultMatch.participant_b_id] : null;

  return (
    <div className="space-y-4">
      {/* create + selector */}
      <div className="grid lg:grid-cols-[380px_1fr] gap-4">
        <Card className="glass-strong p-4 space-y-3">
          <div className="font-bold flex items-center gap-2"><Trophy className="h-4 w-4 text-primary" />Create Tournament</div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Tournament name (words, e.g. "Lomita Shooters League")</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lomita Shooters League" /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Tagline (short slogan)</Label><Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="ONE LEAGUE. NO MERCY." /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Event date (calendar)</Label><Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></div>
          <Button className="btn-luxury w-full" onClick={createTournament}><Plus className="h-4 w-4 mr-1" />Create Tournament</Button>

          {tournaments.length > 0 && (
            <div className="pt-2 space-y-1">
              <Label className="text-xs text-muted-foreground">Select tournament to manage</Label>
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {tournaments.map((t) => (
                  <button key={t.id} onClick={() => setSelId(t.id)} className={`text-left rounded-md px-3 py-2 text-sm border ${selId === t.id ? "border-primary bg-primary/10" : "border-border"}`}>
                    <span className="font-bold">{t.name}</span> <Badge variant="outline" className="ml-1 text-[9px] capitalize">{t.status}</Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        {sel && (
          <Card className="glass-strong p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold flex items-center gap-2"><Swords className="h-4 w-4 text-primary" />Participants — {sel.name}</div>
              <Button size="sm" variant="destructive" onClick={deleteTournament}><Trash2 className="h-3 w-3 mr-1" />Delete</Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Participant name (player / gang)</Label><Input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="e.g. Marki LM" onKeyDown={(e) => e.key === "Enter" && addParticipant()} /></div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Logo URL (optional)</Label><Input value={pLogo} onChange={(e) => setPLogo(e.target.value)} placeholder="https://…" /></div>
              <Button onClick={addParticipant}><Plus className="h-4 w-4" /></Button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {participants.map((p, i) => (
                <Badge key={p.id} variant="outline" className="gap-1 py-1">
                  <span className="text-[10px] text-muted-foreground">{i + 1}.</span>{p.name}
                  <button onClick={() => removeParticipant(p.id)} className="ml-1 text-destructive"><Trash2 className="h-3 w-3" /></button>
                </Badge>
              ))}
              {participants.length === 0 && <span className="text-xs text-muted-foreground">No participants yet.</span>}
            </div>
            <div className="flex flex-wrap gap-2 items-center pt-1">
              <Button className="btn-luxury" onClick={generateBracket}><Wand2 className="h-4 w-4 mr-1" />Generate / Rebuild Bracket</Button>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Betting market</Label>
                <select className="bg-background border border-border rounded-md text-sm px-2 py-1.5" value={sel.futures_match_id ?? ""} onChange={(e) => linkFutures(e.target.value)}>
                  <option value="">— none —</option>
                  {futureMatches.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* live bracket preview / editor */}
      {sel && matches.length > 0 && (
        <Card className="glass p-2">
          <div className="text-xs text-muted-foreground px-2 py-1">Tap any matchup to enter scores and mark the winner. The winner advances automatically.</div>
          <div className="h-[70vh] w-full rounded-xl overflow-hidden">
            <TournamentBracket tournament={sel} participants={partMap} matches={matches} onMatchClick={openResult} />
          </div>
        </Card>
      )}

      {/* glass result dialog */}
      <Dialog open={!!resultMatch} onOpenChange={(o) => !o && setResultMatch(null)}>
        <DialogContent className="glass-strong border-primary/30 max-w-md backdrop-blur-2xl shadow-luxury overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-gold" />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Swords className="h-5 w-5 text-primary" />{resultMatch?.label ?? "Match"} Result</DialogTitle>
            <DialogDescription>Enter the score for each side, then choose who advances to the next round.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground truncate">{rA?.name ?? "Slot A (TBD)"} — score</Label>
              <Input type="number" min={0} value={sA} onChange={(e) => setSA(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground truncate">{rB?.name ?? "Slot B (TBD)"} — score</Label>
              <Input type="number" min={0} value={sB} onChange={(e) => setSB(e.target.value)} placeholder="0" />
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <div className="grid grid-cols-2 gap-2 w-full">
              <Button className="btn-luxury" disabled={!rA} onClick={() => submitResult(resultMatch!.participant_a_id)}><Crown className="h-4 w-4 mr-1" />{rA?.name ?? "A"} wins</Button>
              <Button className="btn-luxury" disabled={!rB} onClick={() => submitResult(resultMatch!.participant_b_id)}><Crown className="h-4 w-4 mr-1" />{rB?.name ?? "B"} wins</Button>
            </div>
            <Button variant="outline" className="w-full" onClick={() => submitResult(null)}>Save scores only (no winner yet)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}