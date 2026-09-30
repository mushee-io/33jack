import {
  getPayment,
  getTelegramWorkspaceMembership,
  roleCan
} from "./_lib/db.js";
import { verifyWhatsAppLaunch } from "./_lib/whatsapp-auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  try {
    const paymentId = String(req.query?.paymentId || "").trim();
    const token = String(req.query?.token || "").trim();
    if (!paymentId || !token) {
      return res.status(400).json({ error: "paymentId and token are required" });
    }

    const auth = verifyWhatsAppLaunch(token, paymentId);
    const membership = await getTelegramWorkspaceMembership(
      `whatsapp:${auth.whatsappUserId}`
    );
    if (!membership || !roleCan(membership.member.role, "view")) {
      return res.status(403).json({ error: "WhatsApp workspace access is not available" });
    }

    const payment = await getPayment(paymentId);
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    if (
      !payment.workspace_id ||
      String(payment.workspace_id) !== String(membership.workspace.id) ||
      String(auth.workspaceId) !== String(membership.workspace.id)
    ) {
      return res.status(403).json({ error: "Payment is not available to this WhatsApp workspace" });
    }

    return res.status(200).json({
      payment,
      channel: "whatsapp",
      workspace: {
        id: membership.workspace.id,
        name: membership.workspace.name,
        role: membership.member.role,
        canApprove: roleCan(membership.member.role, "approve")
      }
    });
  } catch (error) {
    return res.status(401).json({
      error: "WhatsApp review authentication failed",
      detail: error?.message || "Unknown WhatsApp review error"
    });
  }
}
