import Stripe from 'https://esm.sh/stripe@14.21.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2023-10-16',
    })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // ── Verify caller ─────────────────────────────────────────────────────────
    // Releasing escrow captures the guest's card and pays the host, so the
    // caller must be signed in: the booking's host, an admin, or server code
    // using the service role key.
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Authentication required' }, 401)
    }
    const token = authHeader.replace('Bearer ', '')
    const isServiceRole = token === (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    let callerId: string | null = null
    let callerIsAdmin = isServiceRole
    if (!isServiceRole) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token)
      if (authError || !user) {
        return json({ error: 'Invalid or expired session' }, 401)
      }
      callerId = user.id
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      callerIsAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
    }

    const body = await req.json()
    const { bookingId, autoRelease } = body

    // ── Auto-release mode: process all overdue bookings ──────────────────────
    // Only touches bookings already 48h past their date, but it captures
    // payments in bulk, so it is limited to admins and server code.
    if (autoRelease === true) {
      if (!callerIsAdmin) {
        return json({ error: 'Not authorized' }, 403)
      }

      const { data: overdueBookings, error: overdueErr } = await supabase
        .from('bookings')
        .select('*')
        .eq('booking_status', 'confirmed')
        .eq('escrow_status', 'held')
        .eq('auto_released', false)
        .lte('auto_release_at', new Date().toISOString())
        .not('auto_release_at', 'is', null)

      if (overdueErr) {
        return json({ error: overdueErr.message }, 500)
      }

      let released = 0
      for (const booking of (overdueBookings ?? [])) {
        try {
          await processRelease(stripe, supabase, booking, true)
          released++
        } catch (e) {
          console.error(`Auto-release failed for booking ${booking.id}:`, e)
        }
      }

      return json({ success: true, auto_released: released }, 200)
    }

    // ── Manual release mode ───────────────────────────────────────────────────
    if (!bookingId) {
      return json({ error: 'bookingId is required' }, 400)
    }

    const { data: booking, error: bookingErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single()

    // The booking's host is taken from the database, never from the request.
    if (bookingErr || !booking || (!callerIsAdmin && booking.host_id !== callerId)) {
      return json({ error: 'Booking not found or access denied' }, 404)
    }

    if (booking.booking_status === 'completed') {
      return json({ error: 'Booking already completed' }, 400)
    }

    // Hosts can only release funds once the experience date has arrived.
    if (!callerIsAdmin) {
      const today = new Date().toISOString().split('T')[0]
      if (booking.booking_date && String(booking.booking_date) > today) {
        return json({ error: 'Funds can be released on or after the experience date' }, 400)
      }
    }

    const result = await processRelease(stripe, supabase, booking, false)
    return json(result, 200)
  } catch (error) {
    console.error('release-escrow error:', error)
    return json({ error: error.message }, 400)
  }
})

// ── Shared release logic ──────────────────────────────────────────────────────
async function processRelease(stripe: any, supabase: any, booking: any, isAutoRelease: boolean) {
  const paymentIntentId: string = booking.payment_intent_id
  if (!paymentIntentId) {
    throw new Error('No payment intent found for this booking')
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

  let stripeTransferId: string | null = null
  let capturedChargeId: string | null = null

  if (paymentIntent.status === 'requires_capture') {
    const captured = await stripe.paymentIntents.capture(paymentIntentId)
    capturedChargeId = captured.latest_charge as string ?? null

    const { data: hostProfile } = await supabase
      .from('user_profiles')
      .select('stripe_connect_account_id')
      .eq('id', booking.host_id)
      .maybeSingle()

    const hostConnectAccountId: string | null = hostProfile?.stripe_connect_account_id ?? null

    if (hostConnectAccountId) {
      const commissionRate = booking.commission_rate ?? 0.175
      const grossAmount = booking.total_amount ?? 0
      const commissionAmount = Math.round(grossAmount * commissionRate * 100) / 100
      const netPayout = Math.round((grossAmount - commissionAmount) * 100) / 100
      const netPayoutCents = Math.round(netPayout * 100)

      if (netPayoutCents > 0) {
        const transfer = await stripe.transfers.create({
          amount: netPayoutCents,
          currency: booking.currency?.toLowerCase() ?? 'usd',
          destination: hostConnectAccountId,
          source_transaction: capturedChargeId ?? undefined,
          metadata: {
            bookingId: booking.id,
            hostId: booking.host_id,
            grossAmount: grossAmount.toString(),
            commissionAmount: commissionAmount.toString(),
            netPayout: netPayout.toString(),
            autoReleased: isAutoRelease.toString(),
          },
        })
        stripeTransferId = transfer.id
      }
    }
  } else if (paymentIntent.status === 'succeeded') {
    capturedChargeId = paymentIntent.latest_charge as string ?? null
  }

  const commissionRate = booking.commission_rate ?? 0.175
  const grossAmount = booking.total_amount ?? 0
  const commissionAmount = Math.round(grossAmount * commissionRate * 100) / 100
  const netPayout = Math.round((grossAmount - commissionAmount) * 100) / 100

  // Update booking
  await supabase
    .from('bookings')
    .update({
      booking_status: 'completed',
      payment_status: 'succeeded',
      escrow_status: 'released',
      commission_amount: commissionAmount,
      provider_payout_amount: netPayout,
      stripe_charge_id: capturedChargeId,
      auto_released: isAutoRelease,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', booking.id)

  // Upsert provider_payouts
  const { data: existingPayout } = await supabase
    .from('provider_payouts')
    .select('id')
    .eq('booking_id', booking.id)
    .maybeSingle()

  if (existingPayout) {
    await supabase
      .from('provider_payouts')
      .update({
        payout_status: stripeTransferId ? 'paid' : 'processing',
        stripe_transfer_id: stripeTransferId,
        payout_date: stripeTransferId ? new Date().toISOString() : null,
        net_payout: netPayout,
        commission_amount: commissionAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingPayout.id)
  } else {
    await supabase
      .from('provider_payouts')
      .insert({
        host_id: booking.host_id,
        booking_id: booking.id,
        gross_amount: grossAmount,
        commission_rate: commissionRate,
        commission_amount: commissionAmount,
        net_payout: netPayout,
        payout_status: stripeTransferId ? 'paid' : 'processing',
        stripe_transfer_id: stripeTransferId,
        payout_date: stripeTransferId ? new Date().toISOString() : null,
      })
  }

  // Insert earnings record
  const now = new Date()
  const periodLabel = `${now.toLocaleString('default', { month: 'short' })} ${now.getFullYear()}`
  await supabase
    .from('earnings')
    .insert({
      host_id: booking.host_id,
      booking_id: booking.id,
      amount: netPayout,
      payout_status: stripeTransferId ? 'paid' : 'pending',
      period_label: periodLabel,
      payout_date: stripeTransferId ? now.toISOString().split('T')[0] : null,
      booking_count: 1,
    })
    .select()

  // Notify host of auto-release
  if (isAutoRelease) {
    await supabase.from('notifications').insert({
      user_id: booking.host_id,
      type: 'booking_auto_released',
      title: 'Funds Auto-Released',
      body: `Escrow for "${booking.service_name ?? 'your booking'}" was automatically released 48h after the experience date.`,
      data: { booking_id: booking.id, booking_status: 'completed', net_payout: netPayout },
      is_read: false,
      created_at: now.toISOString(),
    })
    await supabase.from('notifications').insert({
      user_id: booking.guest_id,
      type: 'booking_auto_released',
      title: 'Booking Completed',
      body: `"${booking.service_name ?? 'Your booking'}" was automatically marked complete.`,
      data: { booking_id: booking.id, booking_status: 'completed' },
      is_read: false,
      created_at: now.toISOString(),
    })
  }

  return {
    success: true,
    net_payout: netPayout,
    commission_amount: commissionAmount,
    stripe_transfer_id: stripeTransferId,
    host_connected: !!stripeTransferId,
    auto_released: isAutoRelease,
    message: stripeTransferId
      ? `Payment captured and $${netPayout.toFixed(2)} transferred to host via Stripe Connect`
      : `Payment captured. Host payout of $${netPayout.toFixed(2)} queued (host not yet connected to Stripe).`,
  }
}
