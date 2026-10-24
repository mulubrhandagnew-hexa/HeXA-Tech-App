// @ts-ignore: Deno global is available at runtime
declare const Deno: { env: { get: (key: string) => string | undefined } };

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
    status,
  });
}

// Every caller-supplied value is escaped before it goes into the HTML body, so
// the function cannot be used to send arbitrary links or markup.
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

serve(async (req) => {
  if (req?.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { to, subject, type, data } = await req?.json();

    const RESEND_API_KEY = Deno?.env?.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not set");
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

    const recipients: string[] = (Array.isArray(to) ? to : [to])
      .map((r: unknown) => String(r ?? "").trim().toLowerCase())
      .filter((r: string) => r.length > 0);
    if (recipients.length === 0 || recipients.length > 10 || !recipients.every((r) => EMAIL_RE.test(r))) {
      return json({ error: "Invalid recipient" }, 400);
    }

    // ── Who may send to whom ─────────────────────────────────────────────────
    // This function sends from hexatech.app addresses, so it must not be an
    // open relay:
    //   * server code (service role key) and admins: any recipient
    //   * signed-in users: themselves, or people they share a booking with
    //   * not signed in: only the welcome email, only to an account created
    //     in the last 24 hours (signup before email confirmation)
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    let allowed = false;

    if (token && token === serviceKey) {
      allowed = true;
    } else {
      const { data: auth } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
      const user = auth?.user ?? null;

      if (user) {
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        if (profile?.role === "admin" || profile?.role === "super_admin") {
          allowed = true;
        } else {
          const permitted = new Set<string>();
          if (user.email) permitted.add(user.email.toLowerCase());

          const { data: bookings } = await supabase
            .from("bookings")
            .select("guest_id, host_id")
            .or(`guest_id.eq.${user.id},host_id.eq.${user.id}`)
            .limit(500);
          const counterpartIds = [...new Set((bookings ?? [])
            .map((b: { guest_id: string; host_id: string }) => b.guest_id === user.id ? b.host_id : b.guest_id)
            .filter(Boolean))];
          if (counterpartIds.length > 0) {
            const { data: people } = await supabase
              .from("user_profiles")
              .select("email")
              .in("id", counterpartIds);
            for (const p of people ?? []) {
              if (p.email) permitted.add(String(p.email).toLowerCase());
            }
          }

          allowed = recipients.every((r) => permitted.has(r));
        }
      } else if (type === "welcome" && recipients.length === 1) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: newUser } = await supabase
          .from("user_profiles")
          .select("id")
          .ilike("email", recipients[0])
          .gte("created_at", since)
          .maybeSingle();
        allowed = !!newUser;
      }
    }

    if (!allowed) {
      return json({ error: "Not authorized to send this email" }, 403);
    }

    // Subjects are plain text; strip line breaks so they cannot inject headers.
    const cleanSubject = (s: unknown) => String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, 200);

    let html = "";
    let emailSubject = cleanSubject(subject) || "HeXA ELITE Notification";

    const baseStyle = `
      font-family: 'Georgia', serif;
      background-color: #0a0a0a;
      color: #f4f1ea;
      padding: 40px 20px;
      max-width: 600px;
      margin: 0 auto;
    `;

    const headerStyle = `
      text-align: center;
      padding: 30px 0 20px;
      border-bottom: 1px solid #2a2a2a;
      margin-bottom: 30px;
    `;

    const logoText = `
      <div style="${headerStyle}">
        <span style="font-size: 24px; font-weight: bold; color: #c49a2a; letter-spacing: 4px;">HeXA ELITE</span>
        <div style="font-size: 10px; color: #888; letter-spacing: 3px; margin-top: 4px;">NIGHTLIFE & VIP EXPERIENCES</div>
      </div>
    `;

    const footerHtml = `
      <div style="text-align: center; padding: 30px 0 0; border-top: 1px solid #2a2a2a; margin-top: 30px;">
        <p style="color: #555; font-size: 12px; margin: 0;">© ${new Date()?.getFullYear()} HeXA ELITE. All rights reserved.</p>
        <p style="color: #555; font-size: 12px; margin: 8px 0 0;">Premium Nightlife & VIP Experiences</p>
      </div>
    `;

    if (type === "welcome") {
      emailSubject = "Welcome to HeXA ELITE";
      html = `
        <div style="${baseStyle}">
          ${logoText}
          <h2 style="color: #c49a2a; font-size: 22px; margin-bottom: 16px;">Welcome, ${esc(data?.name || "Member")}!</h2>
          <p style="color: #ccc; line-height: 1.7; margin-bottom: 16px;">
            You've joined the most exclusive nightlife and VIP experience platform. Your account is now active and ready to explore.
          </p>
          <p style="color: #ccc; line-height: 1.7; margin-bottom: 24px;">
            Browse verified VIP hosts, yacht charters, private guides, and exclusive events.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://www.hexaelite.app" style="background: #c49a2a; color: #000; padding: 14px 32px; text-decoration: none; font-weight: bold; letter-spacing: 2px; font-size: 13px;">EXPLORE NOW</a>
          </div>
          ${footerHtml}
        </div>
      `;
    } else if (type === "subscription_confirmed") {
      emailSubject = "Subscription Confirmed — HeXA ELITE";
      html = `
        <div style="${baseStyle}">
          ${logoText}
          <h2 style="color: #c49a2a; font-size: 22px; margin-bottom: 16px;">Subscription Confirmed</h2>
          <p style="color: #ccc; line-height: 1.7; margin-bottom: 16px;">
            Your <strong style="color: #c49a2a;">${esc(data?.tier || "Pro")}</strong> plan is now active.
          </p>
          <div style="background: #111; border: 1px solid #2a2a2a; padding: 20px; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin: 0 0 8px; letter-spacing: 2px; text-transform: uppercase;">Plan Details</p>
            <p style="color: #f4f1ea; margin: 4px 0;">Tier: <span style="color: #c49a2a;">${esc(data?.tier || "Pro")}</span></p>
            <p style="color: #f4f1ea; margin: 4px 0;">Billing: ${esc(data?.billing || "Monthly")}</p>
            <p style="color: #f4f1ea; margin: 4px 0;">Amount: $${esc(data?.amount || "0")}</p>
            ${data?.expires_at ? `<p style="color: #f4f1ea; margin: 4px 0;">Valid Until: ${esc(new Date(data.expires_at)?.toLocaleDateString())}</p>` : ""}
          </div>
          ${footerHtml}
        </div>
      `;
    } else if (type === "notification") {
      emailSubject = cleanSubject(data?.title) || "New Notification — HeXA ELITE";
      html = `
        <div style="${baseStyle}">
          ${logoText}
          <h2 style="color: #c49a2a; font-size: 22px; margin-bottom: 16px;">${esc(data?.title || "Notification")}</h2>
          <p style="color: #ccc; line-height: 1.7; margin-bottom: 24px;">${esc(data?.body || "")}</p>
          ${footerHtml}
        </div>
      `;
    } else if (type === "booking_confirmation") {
      emailSubject = cleanSubject(`Booking Confirmed — ${data?.service_name || "Your Experience"} | HeXA ELITE`);
      const base = data?.base_amount ? `$${Number(data.base_amount).toLocaleString()}` : "";
      const fee = data?.service_fee ? `$${Number(data.service_fee).toLocaleString()}` : "";
      const total = data?.total_amount ? `$${Number(data.total_amount).toLocaleString()}` : "";
      const bookingDate = data?.booking_date
        ? new Date(data.booking_date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
        : "TBD";
      const hostEmail = data?.host_email && EMAIL_RE.test(String(data.host_email)) ? String(data.host_email) : "";
      html = `
        <div style="${baseStyle}">
          ${logoText}
          <h2 style="color: #c49a2a; font-size: 22px; margin-bottom: 8px;">Booking Request Received</h2>
          <p style="color: #ccc; line-height: 1.7; margin-bottom: 24px;">
            Hi ${esc(data?.guest_name || "Guest")}, your booking request for <strong style="color: #f4f1ea;">${esc(data?.service_name || "this experience")}</strong> has been submitted successfully. Your host will confirm within 24 hours.
          </p>

          <!-- Reservation Details -->
          <div style="background: #111; border: 1px solid #2a2a2a; border-radius: 12px; padding: 24px; margin-bottom: 20px;">
            <p style="color: #888; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin: 0 0 16px;">Reservation Details</p>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="color: #888; font-size: 13px; padding: 6px 0; width: 40%;">Experience</td>
                <td style="color: #f4f1ea; font-size: 13px; padding: 6px 0; font-weight: bold;">${esc(data?.service_name || "—")}</td>
              </tr>
              <tr>
                <td style="color: #888; font-size: 13px; padding: 6px 0;">Date</td>
                <td style="color: #f4f1ea; font-size: 13px; padding: 6px 0;">${esc(bookingDate)}</td>
              </tr>
              <tr>
                <td style="color: #888; font-size: 13px; padding: 6px 0;">Guests</td>
                <td style="color: #f4f1ea; font-size: 13px; padding: 6px 0;">${esc(data?.guest_count || 1)} guest${Number(data?.guest_count) > 1 ? "s" : ""}</td>
              </tr>
              <tr>
                <td style="color: #888; font-size: 13px; padding: 6px 0;">Location</td>
                <td style="color: #f4f1ea; font-size: 13px; padding: 6px 0;">${esc(data?.location || "See host details")}</td>
              </tr>
              ${data?.guest_message ? `<tr><td style="color: #888; font-size: 13px; padding: 6px 0; vertical-align: top;">Your Note</td><td style="color: #f4f1ea; font-size: 13px; padding: 6px 0; font-style: italic;">"${esc(data.guest_message)}"</td></tr>` : ""}
            </table>
          </div>

          <!-- Pricing Breakdown -->
          <div style="background: #111; border: 1px solid #2a2a2a; border-radius: 12px; padding: 24px; margin-bottom: 20px;">
            <p style="color: #888; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin: 0 0 16px;">Pricing</p>
            <table style="width: 100%; border-collapse: collapse;">
              ${base ? `<tr><td style="color: #888; font-size: 13px; padding: 5px 0;">Base Price</td><td style="color: #f4f1ea; font-size: 13px; padding: 5px 0; text-align: right;">${esc(base)}</td></tr>` : ""}
              ${fee ? `<tr><td style="color: #888; font-size: 13px; padding: 5px 0;">Service Fee</td><td style="color: #f4f1ea; font-size: 13px; padding: 5px 0; text-align: right;">${esc(fee)}</td></tr>` : ""}
              ${total ? `<tr style="border-top: 1px solid #2a2a2a;"><td style="color: #c49a2a; font-size: 14px; font-weight: bold; padding: 10px 0 5px;">Total</td><td style="color: #c49a2a; font-size: 14px; font-weight: bold; padding: 10px 0 5px; text-align: right;">${esc(total)}</td></tr>` : ""}
            </table>
            <p style="color: #555; font-size: 11px; margin: 12px 0 0;">No charge until your booking is confirmed by the host.</p>
          </div>

          <!-- Host Contact -->
          <div style="background: #111; border: 1px solid #2a2a2a; border-radius: 12px; padding: 24px; margin-bottom: 20px;">
            <p style="color: #888; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin: 0 0 16px;">Your Host</p>
            <p style="color: #f4f1ea; font-size: 15px; font-weight: bold; margin: 0 0 4px;">${esc(data?.host_name || "Your HeXA ELITE Host")}</p>
            <p style="color: #888; font-size: 13px; margin: 0 0 12px;">${esc(data?.host_role || "Verified Elite Host")}</p>
            <p style="color: #ccc; font-size: 13px; line-height: 1.6; margin: 0 0 12px;">Your host will reach out to you directly once the booking is confirmed to share meeting point details, any preparation tips, and answer any questions you may have.</p>
            ${hostEmail ? `<p style="color: #888; font-size: 12px; margin: 0;">Host contact: <a href="mailto:${esc(hostEmail)}" style="color: #c49a2a; text-decoration: none;">${esc(hostEmail)}</a></p>` : ""}
          </div>

          <!-- Next Steps -->
          <div style="background: #0d0d0d; border: 1px solid #c49a2a33; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
            <p style="color: #c49a2a; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin: 0 0 16px;">Next Steps</p>
            <div style="display: flex; align-items: flex-start; margin-bottom: 12px;">
              <span style="color: #c49a2a; font-size: 16px; margin-right: 12px; flex-shrink: 0;">1.</span>
              <p style="color: #ccc; font-size: 13px; line-height: 1.6; margin: 0;"><strong style="color: #f4f1ea;">Await confirmation</strong> — Your host will review and confirm your booking within 24 hours.</p>
            </div>
            <div style="display: flex; align-items: flex-start; margin-bottom: 12px;">
              <span style="color: #c49a2a; font-size: 16px; margin-right: 12px; flex-shrink: 0;">2.</span>
              <p style="color: #ccc; font-size: 13px; line-height: 1.6; margin: 0;"><strong style="color: #f4f1ea;">Check your inbox</strong> — Once confirmed, you'll receive a follow-up email with full details and payment instructions.</p>
            </div>
            <div style="display: flex; align-items: flex-start;">
              <span style="color: #c49a2a; font-size: 16px; margin-right: 12px; flex-shrink: 0;">3.</span>
              <p style="color: #ccc; font-size: 13px; line-height: 1.6; margin: 0;"><strong style="color: #f4f1ea;">Prepare for your experience</strong> — Your host will share all preparation details and meeting point information upon confirmation.</p>
            </div>
          </div>

          <div style="text-align: center; margin: 24px 0;">
            <a href="https://www.hexaelite.app" style="background: #c49a2a; color: #000; padding: 14px 32px; text-decoration: none; font-weight: bold; letter-spacing: 2px; font-size: 13px; border-radius: 4px;">VIEW MY BOOKING</a>
          </div>

          <p style="color: #555; font-size: 12px; text-align: center; line-height: 1.6;">
            Need help? Contact us at <a href="mailto:admin@hexatech.app" style="color: #c49a2a; text-decoration: none;">admin@hexatech.app</a><br/>
            Free cancellation available up to 48 hours before your experience.
          </p>

          ${footerHtml}
        </div>
      `;
    } else {
      html = `
        <div style="${baseStyle}">
          ${logoText}
          <p style="color: #ccc; line-height: 1.7;">${esc(data?.message || subject)}</p>
          ${footerHtml}
        </div>
      `;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: type === "booking_confirmation" ? "HeXA ELITE Bookings <accounts@hexatech.app>"
          : type === "subscription_confirmed" ? "HeXA ELITE Billing <billing@hexatech.app>"
          : type === "welcome" ? "HeXA ELITE <hello@hexatech.app>"
          : type === "notification" ? "HeXA ELITE <admin@hexatech.app>" : "HeXA ELITE <hello@hexatech.app>",
        reply_to: "admin@hexatech.app",
        to: recipients,
        subject: emailSubject,
        html,
      }),
    });

    const result = await response?.json();

    if (!response?.ok) {
      throw new Error(result.message || "Failed to send email");
    }

    return json({ success: true, id: result.id }, 200);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
});
