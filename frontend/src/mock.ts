// Mock data for the visual demo. The real wallet + relayer-SDK + contract
// wiring replaces this in step 10. The settlement math below mirrors the
// on-chain logic so the reveal tells a truthful Vickrey story.

export type Phase = "open" | "closed" | "revealed";

export interface SealedBid {
  id: number;
  paddle: string;
  addr: string;
  value: number; // the secret amount — hidden in the UI until reveal
}

// A fixed roster so the reveal lands cleanly:
// Paddle 17 bids highest (310) and wins, but pays the SECOND price (240).
export const ROSTER: Omit<SealedBid, "id">[] = [
  { paddle: "Paddle 04", addr: "0xA1f3…7c2e", value: 240 },
  { paddle: "Paddle 11", addr: "0x9bd0…41af", value: 180 },
  { paddle: "Paddle 17", addr: "0xC20C…4B3E", value: 310 },
  { paddle: "Paddle 23", addr: "0x4E1E…5830", value: 155 },
];

export const SECRET_RESERVE = 200;

export interface Outcome {
  winnerId: number;
  winnerPaddle: string;
  winnerAddr: string;
  clearingPrice: number; // max(second-highest, reserve) if met, else 0
  reserveMet: boolean;
}

export function settle(bids: SealedBid[], reserve: number | null): Outcome {
  const sorted = [...bids].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const second = sorted[1]?.value ?? 0;
  const r = reserve ?? 0;
  const reserveMet = top.value >= r;
  return {
    winnerId: top.id,
    winnerPaddle: top.paddle,
    winnerAddr: top.addr,
    clearingPrice: reserveMet ? Math.max(second, r) : 0,
    reserveMet,
  };
}
