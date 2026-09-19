export type ActionClockSample = { offset: number; roundTrip: number };

// Separate server processing from network transit. Treating a slow DB query as
// half the network round trip makes the browser show the next frame too early.
export function estimateActionClock(
  data: { server_now: number; server_received_at?: number },
  sentAt: number,
  receivedAt: number
): ActionClockSample {
  if (data.server_received_at === undefined) {
    return { offset: data.server_now - receivedAt, roundTrip: Math.max(0, receivedAt - sentAt) };
  }
  const processing = Math.max(0, data.server_now - data.server_received_at);
  return {
    offset: ((data.server_received_at - sentAt) + (data.server_now - receivedAt)) / 2,
    roundTrip: Math.max(0, receivedAt - sentAt - processing)
  };
}
