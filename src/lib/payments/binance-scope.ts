import "server-only";

export function paymentBelongsToRequestScope(
  payment: { customer_id: unknown; panel_id: unknown; gateway: unknown } | null | undefined,
  panelId: string,
  customerId: string
): payment is { customer_id: string; panel_id: string; gateway: "binance_pay"; id: string; amount: unknown; binance_payable: unknown; status: string; created_at: string } {
  if (!payment) return false;
  return (
    payment.customer_id === customerId &&
    payment.panel_id === panelId &&
    payment.gateway === "binance_pay"
  );
}
