# ChangePlace Architecture

## Frontend

- Entry point: [app.js](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/app.js)
- Markup shell: [index.html](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/index.html)
- Styles: [styles.css](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/styles.css)

### Extracted client modules

- Scroll rows and horizontal drag/trackpad behavior:
  [src/client/modules/scroll-row.js](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/src/client/modules/scroll-row.js)
- Filter dropdown controller:
  [src/client/modules/filter-panel.js](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/src/client/modules/filter-panel.js)
- Delivery multi-address field editor:
  [src/client/modules/delivery-addresses.js](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/src/client/modules/delivery-addresses.js)
- Delivery marker presentation and zoom states:
  [src/client/modules/delivery-marker.js](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/src/client/modules/delivery-marker.js)

### Frontend ownership boundary

- `app.js` keeps orchestration, shared state, API work, map lifecycle, sheets, auth, points and proposals.
- `src/client/modules/*` keeps isolated UI behaviors that should evolve without rereading the whole app file.

## Backend

- Server entry point: [server.mjs](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/server.mjs)
- Data file contract: [data/.gitignore](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/data/.gitignore)
- Supabase reference artifacts: [supabase/schema.sql](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/supabase/schema.sql)

### Extracted backend modules

- Config and shared constants:
  [src/server/config.mjs](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/src/server/config.mjs)
- Validation and normalization helpers:
  [src/server/utils.mjs](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/src/server/utils.mjs)
- HTTP and static serving helpers:
  [src/server/http.mjs](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/src/server/http.mjs)
- Store persistence and cleanup:
  [src/server/store.mjs](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/src/server/store.mjs)
- Auth/session/password helpers:
  [src/server/auth.mjs](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/src/server/auth.mjs)

### Current backend status

- `server.mjs` is now the composition root and API route layer.
- Domain logic for points/offers is still inside `server.mjs`.
- Next clean split:
  - `src/server/points.mjs`
  - `src/server/offers.mjs`
  - `src/server/presenters.mjs`

## Deployment

- Runtime config: [config.js](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/config.js)
- Service worker: [service-worker.js](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/service-worker.js)
- Deploy docs: [PROJECT_MAP.md](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/PROJECT_MAP.md)
