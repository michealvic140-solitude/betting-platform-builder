import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";

type LotteryTicket = {
  id: string;
  stake: number;
  status: "pending" | "won" | "lost";
  payout?: number;
  selected_numbers?: number[];
  drawn_at?: string;
};

export interface LotteryHistoryEntry {
  id: string;
  title: string;
  multiplier: number;
  winning_number?: number | null;
  winning_numbers?: number[] | null;
  drawn_at?: string | null;
  status: "pending" | "drawn";
  number_max?: number;
  picks_count?: number;
  tickets?: LotteryTicket[];
}

interface LotteryHistoryDetailCardProps {
  entry: LotteryHistoryEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LotteryHistoryDetailCard({ entry, open, onOpenChange }: LotteryHistoryDetailCardProps) {
  const winningNums = Array.isArray(entry.winning_numbers) && entry.winning_numbers.length 
    ? entry.winning_numbers 
    : entry.winning_number != null 
      ? [entry.winning_number]
      : [];

  const tickets = entry.tickets ?? [];
  const userStats = {
    total: tickets.length,
    won: tickets.filter(t => t.status === "won").length,
    lost: tickets.filter(t => t.status === "lost").length,
    pending: tickets.filter(t => t.status === "pending").length,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-primary/40 max-w-2xl backdrop-blur-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-2xl gradient-gold-text">{entry.title}</DialogTitle>
            <button
              onClick={() => onOpenChange(false)}
              className="text-muted-foreground hover:text-foreground transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </DialogHeader>

        <div className="space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Draw Info Section */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 backdrop-blur p-4 border border-primary/20">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Draw ID</div>
              <div className="font-mono text-sm font-bold truncate text-foreground">{entry.id.slice(0, 8)}</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 backdrop-blur p-4 border border-amber-500/20">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Multiplier</div>
              <div className="text-2xl font-black gradient-gold-text">x{entry.multiplier}</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 backdrop-blur p-4 border border-emerald-500/20">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Range</div>
              <div className="text-lg font-bold text-emerald-300">0–{entry.number_max ?? 9}</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 backdrop-blur p-4 border border-accent/20">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Status</div>
              <Badge className={entry.status === "drawn" ? "bg-emerald-500/30 text-emerald-300 border-emerald-500/30" : "bg-amber-500/30 text-amber-300 border-amber-500/30"}>
                {entry.status.toUpperCase()}
              </Badge>
            </div>
          </div>

          {/* Winning Numbers */}
          {winningNums.length > 0 && (
            <div>
              <div className="text-sm font-bold text-muted-foreground mb-3 uppercase tracking-widest">Winning Numbers</div>
              <div className="flex flex-wrap gap-2">
                {winningNums.map((num, idx) => (
                  <div
                    key={idx}
                    className="h-16 w-16 rounded-xl bg-gradient-gold text-background grid place-items-center border-2 border-amber-300/50 shadow-lg shadow-gold/30"
                  >
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-widest font-bold opacity-80">Win</div>
                      <div className="text-3xl font-black">{num}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Draw Timestamp */}
          {entry.drawn_at && (
            <div className="rounded-lg bg-secondary/30 border border-border/50 p-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Draw Timestamp</div>
              <div className="font-mono text-sm text-foreground">
                {new Date(entry.drawn_at).toLocaleString()}
              </div>
            </div>
          )}

          {/* Your Activity Stats */}
          <div>
            <div className="text-sm font-bold text-muted-foreground mb-3 uppercase tracking-widest">Your Activity</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg bg-card/50 border border-primary/20 p-3 text-center">
                <div className="text-xl font-black text-foreground">{userStats.total}</div>
                <div className="text-[10px] text-muted-foreground uppercase mt-1">Tickets</div>
              </div>
              <div className="rounded-lg bg-card/50 border border-emerald-500/20 p-3 text-center">
                <div className="text-xl font-black text-emerald-300">{userStats.won}</div>
                <div className="text-[10px] text-muted-foreground uppercase mt-1">Won</div>
              </div>
              <div className="rounded-lg bg-card/50 border border-destructive/20 p-3 text-center">
                <div className="text-xl font-black text-destructive">{userStats.lost}</div>
                <div className="text-[10px] text-muted-foreground uppercase mt-1">Lost</div>
              </div>
              <div className="rounded-lg bg-card/50 border border-amber-500/20 p-3 text-center">
                <div className="text-xl font-black text-amber-300">{userStats.pending}</div>
                <div className="text-[10px] text-muted-foreground uppercase mt-1">Pending</div>
              </div>
            </div>
          </div>

          {/* Tickets List */}
          {tickets.length > 0 && (
            <div>
              <div className="text-sm font-bold text-muted-foreground mb-3 uppercase tracking-widest">Your Tickets ({tickets.length})</div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {tickets.map((ticket) => (
                  <Card key={ticket.id} className="glass p-3 border-primary/20 hover:border-primary/40 transition">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-foreground">
                          Stake: <span className="font-mono">{Number(ticket.stake).toLocaleString()}</span> tokens
                        </div>
                        {ticket.selected_numbers && ticket.selected_numbers.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {ticket.selected_numbers.map((num, idx) => (
                              <span
                                key={idx}
                                className={`inline-flex items-center justify-center h-6 w-6 rounded text-xs font-bold ${
                                  winningNums.includes(num)
                                    ? "bg-emerald-500/40 text-emerald-300 border border-emerald-500/50"
                                    : "bg-secondary/60 text-foreground border border-border"
                                }`}
                              >
                                {num}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <Badge
                          className={
                            ticket.status === "won"
                              ? "bg-emerald-500/30 text-emerald-300 border-emerald-500/30"
                              : ticket.status === "lost"
                                ? "bg-destructive/30 text-destructive border-destructive/30"
                                : "bg-amber-500/30 text-amber-300 border-amber-500/30"
                          }
                        >
                          {ticket.status.toUpperCase()}
                        </Badge>
                        {ticket.payout && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Payout: <span className="font-bold text-emerald-300">{Number(ticket.payout).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
