# Rocket prompt: separate admin login

Paste the text below into the HeXA ELITE project in Rocket.

---

Create a separate admin sign-in, distinct from the guest/host sign-in and sign-up.

1. New page at `/admin/login`:
   - Title "HeXA ELITE Admin", same dark/gold styling as the site.
   - Fields: Email, Password, "Sign in" button, and a "Forgot password?" link
     (Supabase `resetPasswordForEmail`, redirectTo `https://www.hexaelite.app/admin/login`).
   - No "Sign up", no "Sign in as Guest", no social logins, no link to the host sign-up.
   - On submit: `supabase.auth.signInWithPassword`, then call
     `supabase.rpc('is_admin_user')`. If it returns true, go to `/admin`.
     If false, call `supabase.auth.signOut()` and show
     "This account does not have admin access."
   - Add `<meta name="robots" content="noindex, nofollow">` to this page.

2. Protect every `/admin` route:
   - If there is no session, redirect to `/admin/login` (not `/login`).
   - If there is a session but `rpc('is_admin_user')` is false, sign out and
     redirect to `/admin/login` with the same error message.

3. Keep the existing `/login` and sign-up pages for guests and hosts only:
   - Remove any admin option from them.
   - After a guest/host signs in there, never redirect to `/admin`, even if
     `?next=/admin` is in the URL; send them to their normal dashboard.

4. Footer: add a small, low-emphasis link "Admin" pointing to `/admin/login`,
   next to Privacy Policy and Terms of Service, on every page.

5. Update `robots.txt` to include `Disallow: /admin/`.

Do not change any Supabase tables, policies or functions; admin access is
already enforced in the database.
