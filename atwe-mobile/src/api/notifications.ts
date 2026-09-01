import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Notifications — mirrors `GET /api/notifications` (+ `/count` and the mark-read
 * POST). Shapes match server.js (~19973). Each row carries the actor + the
 * target ids so a tap can deep-link (post / profile / chat / job).
 */
export interface NotifActor {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  accountType: 'personal' | 'business';
  verified: boolean;
}
export interface Notification {
  id: number;
  type: string;
  postId: number | null;
  groupId: number | null;
  jobId: number | null;
  productId: number | null;
  read: boolean;
  created_at: string;
  postBody: string | null;
  jobTitle: string | null;
  productName: string | null;
  actor: NotifActor;
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{ unread: number; notifications: Notification[] }>('/api/notifications'),
  });
}

export function useNotifCount() {
  return useQuery({
    queryKey: ['notif-count'],
    queryFn: () => api.get<{ unread: number }>('/api/notifications/count'),
    refetchInterval: 30_000,
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/api/notifications/read');
}

/** Human sentence for a notification verb (mirrors the web verb dictionary). */
export function notifText(n: Notification): string {
  /* GENERATED FROM THE SERVER, not written by hand. The client used to know 21
     verbs while the server sent 106, so a job application, a split request and
     an accepted quote all read "interacted with you" — which tells somebody
     nothing and makes the whole page look broken. tools/check-notif-verbs.js
     fails the build if the server grows one this map has not got.

     A handful are worded differently on purpose: a PUSH says "sent you money —
     it is in your wallet" because you cannot see the wallet from a lock screen,
     while the row in the app sits one tap from it. */
  const map: Record<string, string> = {
    /* `app_<status>` is built at the moment a hiring status changes
       (APPLICANT_STATUSES on the server), so it is NOT in PUSH_VERBS and the
       generator cannot see it. Named by hand, and the reason is recorded here so
       nobody deletes them thinking the generator will put them back. */
    app_hired: 'hired you',
    app_rejected: 'has passed on your application',
    app_reviewed: 'looked at your application',
    app_shortlisted: 'shortlisted you',
    ad_approved: "approved your ad — it’s ready to pay",
    ad_rejected: "reviewed your ad",
    ad_review: "submitted an ad for review",
    aff_accepted: "accepted your affiliation",
    aff_approved: "approved your affiliation badge",
    aff_invite: "invited you as an affiliate",
    aff_rejected: "reviewed your affiliation badge",
    aff_review: "submitted an affiliation badge",
    appeal_granted: "reviewed your appeal — your account is active again",
    appt_reminder: "has an appointment with you soon",
    appt_request: "requested an appointment",
    appt_rescheduled: "proposed a new appointment time",
    auction_ended: "your auction ended — the winner is paying",
    auction_no_bids: "your auction ended without bids",
    auction_outbid: "outbid you — bid again to stay in it",
    auction_won: "you won the auction — pay to claim it",
    call: "called you",
    call_reminder: "has a call with you soon",
    certified: "You are now Atwe Certified",
    chat_request: "wants to chat with you",
    comment: "commented on your post",
    community_boost: "boosted your community",
    connection: "wants to connect",
    connection_accepted: "accepted your connection",
    connection_request: "wants to connect",
    course_cancelled: "removed a course you bought",
    creator_sub: "subscribed to you",
    crm_followup: "is due a follow-up — you set a reminder",
    delivery_agreed: "the courier is agreed — it is on its way",
    delivery_approve_needed: "needs your approval on a courier",
    delivery_delivered: "says your order has been delivered",
    delivery_offer: "offered to deliver your order",
    delivery_on_way: "is on the way with your order",
    delivery_paid: "you have been paid for that delivery",
    delivery_picked_up: "has picked up your order",
    digital_ready: "your purchase is ready",
    endorse: "endorsed your skill",
    endorsement: "endorsed your skills",
    escrow_refunded: "refunded a held order — your money is back",
    escrow_released: "released your payment — it is in your wallet",
    event_cancelled: "cancelled an event you were going to",
    event_comment: "commented on your event",
    event_reminder: "an event you’re going to starts soon",
    event_rsvp: "is going to your event",
    event_spot: "a spot opened up — you’re in!",
    follow: "followed you",
    gift_received: "sent you a gift card",
    group_join_paid: "paid your group’s join fee",
    invoice: "sent you an invoice",
    invoice_paid: "paid your invoice",
    invoice_reminder: "sent a reminder — an invoice is waiting",
    job_application: "applied to your job",
    like: "liked your post",
    login: "New sign-in to your account",
    mention: "mentioned you",
    message: "sent you a message",
    money_drop_done: "opened the last share of your money drop",
    money_drop_expired: "your money drop expired",
    money_received: "sent you money",
    money_request: "requested money from you",
    money_request_paid: "paid your money request",
    offer: "sent you an offer",
    order: "placed an order with you",
    order_delivered: "marked your order delivered",
    order_disputed: "opened a dispute on an order",
    order_refunded: "refunded your order",
    order_shipped: "shipped your order",
    payment: "made a payment to Atwe",
    pot_save_skipped: "an auto-save was skipped — balance too low",
    pot_saved: "auto-saved into your pot",
    quote: "quoted your post",
    quote_accepted: "accepted your quote",
    quote_received: "sent you a quote",
    rec_received: "recommended you",
    refund_approved: "approved your refund",
    remix: "remixed your video",
    rental_booked: "booked your rental — Instant Book confirmed it",
    rental_cancelled: "cancelled a booking",
    rental_confirmed: "confirmed your booking — you can pay now",
    rental_declined: "declined your booking request",
    rental_paid: "paid for their booking",
    rental_request: "requested to book your rental",
    reply: "replied to your post",
    repost: "reposted your post",
    restock: "restocked an item you saved",
    return_label_ready: "sent you a prepaid return label",
    return_request: "asked you to return a payment sent by mistake",
    return_requested: "requested a return",
    review_invite: "How did it go? Leave a review",
    review_reply: "responded to your review",
    rinv_paused: "a recurring invoice was paused",
    sched_pay_failed: "a scheduled payment couldn’t be sent",
    service_lead: "needs a pro — a new request in your category",
    shop_campaign: "has news for you",
    showcase_comment: "commented on your showcase",
    showcase_like: "appreciated your showcase",
    split_paid: "paid their share of a split",
    split_reminder: "sent a reminder — your share of a split is waiting",
    split_request: "asked you to split a bill",
    stock_low: "is running low — only a few left",
    stock_out: "has sold out",
    story_mention: "mentioned you in their Daily",
    strike: "issued a warning on your account — tap for details",
    sub_out_of_stock: "a subscription item is out of stock",
    sub_paused: "paused your subscription",
    sub_payment_failed: "couldn’t bill your subscription",
    sub_renewed: "your subscription order is on its way",
    team_invite: "invited you to their team",
    tip: "sent you a tip",
    video_call: "video-called you",
    wallet_frozen: "placed a temporary hold on your wallet",
    webinar_cancelled: "cancelled a webinar you signed up for",
    webinar_live: "is live now — the webinar you signed up for has started",
  };
  return map[n.type] || 'interacted with you';
}
