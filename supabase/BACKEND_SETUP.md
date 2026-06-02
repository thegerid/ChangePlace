# Backend setup on Supabase Free

This setup keeps the frontend on GitHub Pages and uses Supabase Free for public map data.

Current mode: no registration. Any visitor can open the map and see active points. A browser can edit/delete only the point created from the same `device_id` stored in localStorage/cookie.

## 1. Create a free Supabase project

1. Open https://supabase.com/dashboard.
2. Create a new project.
3. In `Project Settings > API`, copy:
   - Project URL
   - `anon public` / `publishable` key

## 2. Run SQL

Open `SQL Editor` and run the whole `supabase/schema.sql` file.

If you previously ran the registration-based schema, run this file again. It contains migration statements that add public `device_id` mode.

## 3. Enable Realtime

In `Database > Replication`, enable Realtime for:

- `points`;
- `exchange_offers`;
- `exchange_stats`.

## 4. Daily cleanup

Free path while testing:

```sql
select public.cleanup_daily_points();
```

Production path, if Supabase Cron is enabled:

```sql
select cron.schedule(
  'changeplace-cleanup',
  '59 20 * * *',
  'select public.cleanup_daily_points();'
);
```

`20:59 UTC` equals `23:59 Europe/Moscow`.

## 5. Connect the site

Edit `config.js`:

```js
window.CHANGEPLACE_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

Commit and push.

The anon/publishable key is public by design. Direct reads/writes for `points` and `exchange_offers` are blocked; public reads and writes go through SQL RPC functions. The browser `device_id` is used only server-side to decide which point belongs to the current device and is not exposed for other users.
