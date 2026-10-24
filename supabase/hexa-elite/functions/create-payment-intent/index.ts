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
    // ── 1. Verify JWT — reject unauthenticated requests ──────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ success: false, code: 'UNAUTHORIZED', message: 'Authentication required.' }, 401)
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2023-10-16',
    })

    // Use service role for DB writes, but verify user JWT first
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const userToken = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(userToken)
    if (authError || !user) {
      return json({ success: false, code: 'UNAUTHORIZED', message: 'Invalid or expired session.' }, 401)
    }

    const { paymentData, customerInfo } = await req.json()
    const { currency, description, bookingData } = paymentData
    const { email, firstName, lastName, stripeCustomerId } = customerInfo

    // ── 2. Server-side amount calculation — NEVER trust client amount ─────────
    const durationHours = parseInt(bookingData?.durationHours ?? 1)
    const guestCount = parseInt(bookingData?.guestCount ?? 1)
    if (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 24) {
      return json({ success: false, code: 'INVALID_DURATION', message: 'Invalid booking duration.' }, 400)
    }

    // The price and the host to pay always come from the listing in the
    // database. Without a valid listing there is no booking.
    const listingKey = bookingData?.listingId ?? bookingData?.hostId
    if (!listingKey) {
      return json({ success: false, code: 'MISSING_LISTING', message: 'A listing is required.' }, 400)
    }
    const { data: listing, error: listingError } = await supabaseAdmin
      .from('listings')
      .select('id, host_id, price_per_hour, is_available')
      .eq('id', listingKey)
      .maybeSingle()

    if (listingError || !listing) {
      return json({ success: false, code: 'LISTING_NOT_FOUND', message: 'This listing could not be found.' }, 400)
    }
    if (!listing.is_available) {
      return json({ success: false, code: 'LISTING_UNAVAILABLE', message: 'This listing is no longer available.' }, 400)
    }

    const baseAmount = Math.round(listing.price_per_hour * durationHours * 100) / 100
    const serviceFee = Math.round(baseAmount * 0.12 * 100) / 100
    const platformFee = Math.round(baseAmount * 0.03 * 100) / 100
    const serverCalculatedAmount = Math.round((baseAmount + serviceFee + platformFee) * 100) / 100

    if (serverCalculatedAmount <= 0) {
      return json({ success: false, code: 'INVALID_AMOUNT', message: 'Invalid booking amount.' }, 400)
    }

    // ── 3. Build or retrieve Stripe Customer ─────────────────────────────────
    const customerData = {
      email: email ?? user.email ?? 'admin@hexatech.app',
      name: `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'HeXA ELITE Guest',
      metadata: { userId: user.id },
    }

    let stripeCustomer
    if (stripeCustomerId) {
      try {
        stripeCustomer = await stripe.customers.update(stripeCustomerId, customerData)
      } catch {
        stripeCustomer = await stripe.customers.create(customerData)
      }
    } else if (user.email) {
      const existing = await stripe.customers.list({ email: user.email, limit: 1 })
      stripeCustomer = existing.data.length > 0
        ? existing.data[0]
        : await stripe.customers.create(customerData)
    } else {
      stripeCustomer = await stripe.customers.create(customerData)
    }

    // ── 4. Create PaymentIntent with idempotency key ──────────────────────────
    // Idempotency key: userId + listingId + bookingDate + amount prevents duplicate charges
    const idempotencyKey = `pi_${user.id}_${listing.id}_${bookingData?.bookingDate ?? Date.now()}_${durationHours}`
    const amountInCents = Math.round(serverCalculatedAmount * 100)

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCents,
        currency: currency ?? 'usd',
        customer: stripeCustomer.id,
        description: description ?? 'HeXA ELITE Booking',
        payment_method_types: ['card'],
        capture_method: 'manual', // ESCROW: authorize now, capture on completion
        metadata: {
          userId: user.id,
          hostId: listing.host_id,
          listingId: listing.id,
          bookingDate: bookingData?.bookingDate ?? '',
          serverCalculatedAmount: serverCalculatedAmount.toString(),
          escrow: 'true',
          environment: Deno.env.get('ENVIRONMENT') ?? 'production',
        },
      },
      { idempotencyKey }
    )

    // ── 5. Save pending booking record ───────────────────────────────────────
    let recordId: string | null = null
    try {
      const { data: existing } = await supabaseAdmin
        .from('bookings')
        .select('id')
        .eq('payment_intent_id', paymentIntent.id)
        .maybeSingle()

      if (existing?.id) {
        recordId = existing.id
      } else {
        const { data, error: insertError } = await supabaseAdmin
          .from('bookings')
          .insert({
            guest_id: user.id,
            host_id: listing.host_id,
            listing_id: listing.id,
            booking_date: bookingData?.bookingDate ?? new Date().toISOString().split('T')[0],
            booking_time: bookingData?.bookingTime ?? '',
            duration_hours: durationHours,
            guest_count: Number.isFinite(guestCount) && guestCount > 0 ? guestCount : 1,
            service_name: bookingData?.serviceName ?? 'Experience',
            base_amount: baseAmount,
            service_fee: serviceFee,
            platform_fee: platformFee,
            total_amount: serverCalculatedAmount,
            booking_total: serverCalculatedAmount,
            payment_method: bookingData?.paymentMethod ?? 'card',
            booking_status: 'pending',
            payment_intent_id: paymentIntent.id,
            payment_status: 'authorized',
            escrow_status: 'held',
          })
          .select('id')
          .single()
        if (insertError) console.error('Booking insert error:', insertError)
        recordId = data?.id ?? null
      }
    } catch (dbErr) {
      console.error('DB insert error (non-fatal):', dbErr)
    }

    // Update user profile with stripe_customer_id
    try {
      await supabaseAdmin
        .from('user_profiles')
        .update({ stripe_customer_id: stripeCustomer.id })
        .eq('id', user.id)
    } catch (e) {
      console.error('Profile stripe_customer_id update error (non-fatal):', e)
    }

    return json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      customerId: stripeCustomer.id,
      recordId,
      serverCalculatedAmount,
    }, 200)
  } catch (error) {
    console.error('create-payment-intent error:', error)
    return json({ success: false, code: 'INTERNAL_ERROR', message: error.message }, 400)
  }
})
