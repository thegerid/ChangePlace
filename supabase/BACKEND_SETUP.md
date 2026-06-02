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
