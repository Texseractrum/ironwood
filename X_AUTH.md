# X login

Guests can explore and build immediately. The floating X button above their engineer says “Log in to save progress.” Login replaces it with their X photo, display name, verification badge, and organisation badge when available. Other engineers see the same public identity. Account controls are also available from World and Settings.

The first login links the current guest's base, inventory, and discoveries to the stable X user ID. Later logins restore that account's existing workshop, even after changing handles or switching browsers. If an account already owns a workshop, it takes precedence over the current guest; inventories and bases are not merged. Logging out preserves the account's workshop and starts a new guest.

X-linked engineers also appear on the public **Leaderboard**, ranked by total materials currently in their account inventory, counting each item equally. Offline accounts remain ranked; guests and identities supplied by clients are excluded. Paid X verification is not required. Each clan member uses the shared clan inventory total, and tied totals receive the same rank. `GET /api/leaderboard?page=1` returns up to 50 public profiles with `totalMaterials` scores, the total and page count, and the signed-in viewer’s rank when their game-session cookie is valid. Responses are private and uncached; no guest tokens or inventory breakdowns are included. Rankings are derived from the existing saved world and need no new binding or migration.

## Configure an X app

1. Create an app in the [X Developer Console](https://console.x.com/) and enable OAuth 2.0 user authentication. Choose **Web App / Automated App or Bot**, a confidential client that provides both a client ID and client secret. Use read permissions.
2. Register the exact callback URL for each environment:
   - Production: `https://ironwood.sparkles.dev/api/auth/x/callback`
   - Local Worker: `http://localhost:8787/api/auth/x/callback`
   - Vite with the Worker proxy: `http://localhost:5173/api/auth/x/callback`
3. Set `X_CLIENT_ID`, `X_CLIENT_SECRET`, and `X_REDIRECT_URI` on the Worker. `X_REDIRECT_URI` must match the origin where players open the game. Select one local origin at a time; do not mix `localhost` and `127.0.0.1`.

For local development, copy `.dev.vars.example` to the ignored `.dev.vars`, supply the credentials, and run `npm run dev:multiplayer`. To use Vite hot reload, set the redirect URI to the port 5173 URL, run the Worker on 8787 and Vite on 5173, then open port 5173. Credentials belong only in `.dev.vars`, never browser-exposed `VITE_` variables.

For production, set the credentials with:

```sh
npx wrangler secret put X_CLIENT_ID
npx wrangler secret put X_CLIENT_SECRET
npx wrangler secret put X_REDIRECT_URI
```

Use the production callback URL for the final value. A code deployment is also required to publish this integration. This work does not create an X app or deploy the game.

The app must have access to `GET /2/users/me`; check its API access and credits in the X console. The implementation requests `tweet.read users.read`, with no posting, direct-message, email, or refresh-token permissions. See [X's OAuth 2.0 guide](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code) and [authenticated user endpoint](https://docs.x.com/x-api/users/get-my-user).

## Profile fields

Login requests `profile_image_url`, `verified`, `verified_type`, and `affiliation`, with the `affiliation.user_id` expansion. Business badges use gold, government badges grey, and other verified profiles blue. Missing photos use initials. An organisation badge uses `affiliation.badge_url`, or the expanded organisation's profile image. These fields depend on what X returns; absent verification or affiliation is never invented. If X rejects the affiliation request with 400/403, login retries with the core profile fields. A failed or rate-limited lookup leaves the guest's progress intact. See [X's user field dictionary](https://docs.x.com/x-api/fundamentals/data-dictionary#user).

Only HTTPS images hosted on `pbs.twimg.com` are accepted, and profile names render as text. Public snapshots carry profile metadata, never credentials. Profile metadata refreshes at login; it is not polled from X while playing.

## Sessions and persistence

OAuth uses random, single-use, ten-minute state plus S256 PKCE, validated against an HttpOnly, SameSite=Lax cookie. The Worker exchanges the authorization code and reads the profile. The X access token is discarded after that lookup. An opaque, revocable, 30-day game session is issued in an HttpOnly cookie, with Secure and `__Host-` protection on HTTPS.

Auth records live in the existing SQLite-backed shared-world Durable Object, alongside the world persistence. No new Cloudflare binding is needed. Session keys are hashed, expired auth records are cleaned hourly, logout closes that session's sockets, and live authenticated connections expire with their sessions. Linking a guest revokes the guest's browser token and requires reconnecting with the account cookie. The server chooses the identity for WebSocket joins; a client cannot claim verification or an X account through a join message.

Guest progress currently remains on the world server and can be resumed using the same browser's site data. X login makes it recoverable across devices; it does not introduce guest-data deletion.

## Verification

`npm test` includes OAuth state/PKCE validation, cookie protection, cancellation/replay/expiry, login failures, profile parsing, guest linking, returning-account precedence, and logout checks. `node tools/auth-integration-test.mjs` exercises the production Worker and Durable Object with a local fake X provider, including WebSocket access and cross-browser account recovery. Real X consent must still be tested after supplying app credentials.

For visual and browser integration checks, run `npx vite build --outDir .context/x-auth-assets` followed by `node tools/auth-browser-test.mjs`. This starts an isolated Worker with a fake X provider and verifies login, cancelled consent, badges, logout, account restoration in a second browser, and smaller viewports. It never sends credentials to X or touches production game data. Screenshots with `fixture` in their names contain a test profile.
