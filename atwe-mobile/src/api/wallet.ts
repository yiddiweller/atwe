import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Wallet — the peer-to-peer money surface. Mirrors `GET /api/wallet`
 * ({ balanceCents, transactions }) and `POST /api/wallet/send`. Shapes match
 * server.js (~13299). Amounts are in cents; `deltaCents` is signed per tx.
 */
export interface WalletPeer {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  accountType: 'personal' | 'business';
}
export interface WalletTx {
  id: number;
  kind: string; // send | receive | topup | pot_in | pot_out | cashout | …
  deltaCents: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
  peer: WalletPeer | null;
}
export interface WalletData {
  balanceCents: number;
  transactions: WalletTx[];
}

export function useWallet() {
  return useQuery({
    queryKey: ['wallet'],
    queryFn: () => api.get<WalletData>('/api/wallet'),
    staleTime: 10_000,
  });
}

/** Send money to a @username. `amount` is a dollar string ($1–$2,000). */
export async function sendMoney(input: {
  to: string;
  amount: string;
  note?: string;
  clientId: string;
}): Promise<void> {
  await api.post('/api/wallet/send', {
    to: input.to.trim().replace(/^@/, ''),
    amount: input.amount,
    note: input.note?.trim() || undefined,
    clientId: input.clientId,
  });
}

/** cents → "$1,234.56" (absolute value; the sign is shown separately). */
export function money(cents: number): string {
  const v = Math.abs(cents) / 100;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A human label for a wallet transaction row. */
export function txLabel(tx: WalletTx): string {
  if (tx.peer) return tx.deltaCents < 0 ? `To ${tx.peer.name}` : `From ${tx.peer.name}`;
  const map: Record<string, string> = {
    topup: 'Added money',
    cashout: 'Cash out to bank',
    pot_in: 'Moved to pot',
    pot_out: 'Moved from pot',
    handle: 'Bought a handle',
  };
  return map[tx.kind] || (tx.deltaCents < 0 ? 'Payment' : 'Received');
}
