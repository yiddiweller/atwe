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

/* ─── Putting money in, and taking it out ──────────────────────────────────
   Both go through the routes the web already uses, so the rules — the limits,
   the velocity caps, a frozen wallet — are enforced in exactly one place and
   the phone cannot get around any of them by asking differently.
*/
export async function topUp(input: { amount: number; clientId: string }): Promise<{ url?: string; ok?: boolean }> {
  return api.post('/api/wallet/topup', input);
}

export interface CashoutStatus {
  configured: boolean;
  connected: boolean;
  payoutsEnabled: boolean;
  balanceCents: number;
}
export function useCashoutStatus() {
  return useQuery({
    queryKey: ['cashout-status'],
    queryFn: () => api.get<CashoutStatus>('/api/wallet/cashout-status'),
  });
}
export async function cashOut(input: { amount: number; clientId: string }) {
  return api.post('/api/wallet/cashout', input);
}
/** The hosted page where a bank account is connected. */
export async function connectBank(): Promise<{ url?: string }> {
  return api.post('/api/wallet/connect', {});
}

/* ─── Asking somebody for money ─── */
export interface MoneyRequest {
  id: number;
  amountCents: number;
  note?: string | null;
  status: 'pending' | 'paid' | 'declined' | 'cancelled';
  createdAt: string;
  requester?: { id: number; name: string; username: string; avatar?: string | null } | null;
  payer?: { id: number; name: string; username: string; avatar?: string | null } | null;
}
export function useMoneyRequests(scope: 'incoming' | 'outgoing') {
  return useQuery({
    queryKey: ['money-requests', scope],
    queryFn: () => api.get<{ requests: MoneyRequest[] }>(`/api/wallet/requests?scope=${scope}`),
  });
}
export async function requestMoney(input: { to: string; amount: number; note?: string }) {
  return api.post('/api/wallet/request', input);
}
export async function payMoneyRequest(id: number, clientId: string) {
  return api.post(`/api/wallet/requests/${id}/pay`, { clientId });
}
export async function declineMoneyRequest(id: number) {
  return api.post(`/api/wallet/requests/${id}/decline`, {});
}
