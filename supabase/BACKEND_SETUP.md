# Backend setup on Supabase Free

This setup keeps the frontend on GitHub Pages and uses Supabase Free for auth, database, realtime, and scheduled cleanup.

## 1. Create a free Supabase project

1. Open https://supabase.com/dashboard.
2. Create a new project.
3. In `Project Settings > API`, copy:
   - Project URL
   - `anon public` key

## 2. Run SQL

Open `SQL Editor` and run the whole `supabase/schema.sql` file.

## 3. Enable email OTP

In `Authentication > Providers > Email`:

- enable Email provider;
- enable OTP / magic link flow;
- add `https://goswitch.ru` to allowed redirect URLs.

## 3.1. Send only a numeric code, not a login link

The frontend already uses the code flow:

- `supabase.auth.signInWithOtp(...)` sends the email;
- `supabase.auth.verifyOtp({ email, token, type: "email" })` verifies the code typed in the app.

To make the email contain only the code:

1. Open `Authentication > Email Templates`.
2. Open the `Magic Link` template.
3. Replace the template body with this:

```html
<h2>Код входа в ChangePlace</h2>
<p>Введите этот код в приложении:</p>
<p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">{{ .Token }}</p>
<p>Если вы не запрашивали вход, просто проигнорируйте это письмо.</p>
```

4. Open the `Confirm Signup` template and use the same body.

Do not include `{{ .ConfirmationURL }}` in either template if users should not click links. Supabase's `{{ .Token }}` variable contains the 6-digit OTP code.

## 4. Restrict registration to `@alfabank.ru`

In `Authentication > Hooks`:

- choose `Before User Created`;
- select Postgres function `public.hook_restrict_signup_by_email_domain`;
- save.

This blocks users whose email does not end with `@alfabank.ru`.

## 5. Enable Realtime

In `Database > Replication`, enable Realtime for:

- `points`;
- `exchange_offers`;
- `exchange_stats`.

## 6. Daily cleanup

Free path: open the Supabase SQL Editor daily while testing and run:

```sql
select public.cleanup_daily_points();
```

Production path: use Supabase Cron if enabled on the plan:

```sql
select cron.schedule(
  'changeplace-cleanup',
  '59 20 * * *',
  'select public.cleanup_daily_points();'
);
```

`20:59 UTC` equals `23:59 Europe/Moscow`.

## 7. Connect the site

Edit `config.js`:

```js
window.CHANGEPLACE_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

Commit and push. The anon key is public by design; security is enforced by RLS policies.
