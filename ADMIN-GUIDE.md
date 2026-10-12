# East Star floor app: admin guide

For a second admin (someone who helps Ray run the app). The app is at https://rayk1945-glitch.github.io/east-star-floor/ .
On a phone: open it in Safari or Chrome, then use **Share → Add to Home Screen** (iPhone) or **Install app** (Android).

## 1. Signing in
- Type your **name** and **password** (tap **Show** to see what you typed). Passwords can use any characters, at least 6.
  Old PINs still work as the password. If an old PIN is shorter than 6, the app asks you to pick a new password right
  after you sign in. The first time you sign in with a temporary password, the app asks you to pick your own.
- **Fingerprint / Face ID:** after a password sign-in, the phone offers **Use fingerprint / Face ID next time**
  (下次用指纹/面容登录). Tap **Turn on**. Next time, tap **Sign in with fingerprint / Face ID** on the sign-in screen.
  The fingerprint or face never leaves the phone; the server only keeps a public key and checks every sign-in itself.
  **Forget on this phone** (under the button) turns it off on that phone. It only works on the app's own web address.
- **Admin** is in the top bar. It only shows for admins and account admins.
- Sessions stay signed in on that phone. **Sign out** on shared devices.
- Roles:
  - **admin**: every account, every project, bot webhooks, every login. Ray is admin. A second admin is made in
    Admin → Add a login with Role "admin (all accounts)". Only a full admin sees that option.
  - **account admin**: adds, pauses, renames and resets the staff of their own account, can ping their bot, and can add and
    edit accounts (Admin → Add an account) and set the webhook URL + key of ANY account (Set webhook). Staff and warehouse
    logins cannot. Every change is logged.
  - **staff**: Search, Projects/notes, quotes and plans.
  - **warehouse** (仓库): Search items and see on-hand and incoming stock only. Prices are never shown, at any hour: the
    server removes them before anything is sent. No projects, notes, history, quotes, Send plan, cart, client links or Admin
    (the server refuses those too). Admins and account admins can give this role.
- **Change my password** (修改我的密码): tap the 🔑 key button next to Sign out. Type your current password, then the new one
    twice (at least 6 characters). Works for every login, admin included.

## 2. Staff logins (Admin → Staff / Add a login)
- **Add:** Name + **temporary password** (6+ characters) + Account + Role → **Add / reset login**. Give them the temporary
  password in person (never by text). They pick their own password at first sign-in.
- **Reset password:** tap **Reset password** on their row (or add the same name again). This signs them out everywhere. They
  pick a new password at the next sign-in. Their saved fingerprint / Face ID devices stay; use **Remove saved devices** too
  if the phone may be in the wrong hands.
- **Rename:** tap **Rename** on their row. They sign in with the new name from then on. Their projects, shares, Send to and
  saved devices stay with the login (it keeps the same login id). Past requests in History keep the name they were sent with.
- **Remove saved devices:** shows when a login has fingerprint / Face ID turned on ("fingerprint / Face ID on N devices").
  It turns it off on all their phones; they sign in with the password and can turn it on again.
- **Pause / Resume:** **Pause** signs them out now and blocks sign-in (password AND fingerprint / Face ID) until **Resume**.
  Use it when someone leaves or loses a phone. Their projects stay.
- **Delete:** removes the login and its saved devices. Their projects and history are kept (shown as "deleted: <name>").
- No one can pause themselves or the admin login.

## 3. Accounts and bots (Admin → accounts)
- An **account** = one Grok Bot that receives "Send plan" and cart quote requests. Each account has: account ID, bot name,
  **CSV customer ID** (the bot's own NetSuite customer ID; it goes on every NetSuite CSV, never the end customer's name),
  and a plan share email (the Google account that bot's Drive connector uses to open plan photos).
- **Set webhook:** paste the **URL + key** from that bot's webhook routine panel. They are stored on the server only and are
  never shown again (you see "set" and the last 4 characters). Then tap **Ping bot**: "sent" means the bot got it.
- Every login belongs to one account. Projects shared with "my team" are shared inside that account.

## 4. Bot routing per login ("Send to")
- Each staff row in **Admin → Staff** has a **Send to** dropdown listing every account (bot). By default a login sends
  to its own account's bot.
- Pick another account (e.g. **SF orders**) and that login's plan, cart and re-send requests go to that bot, using
  that account's webhook, **CSV customer ID** and plan share. The login stays in its own account, so its projects and
  team visibility don't change. Picking the login's own account again resets it. Every change is logged.
- The login's top button then reads **"Send plan to SF orders"**, and History shows "→ bot" on each request.
  A re-send always goes back to the bot that got the original request.
- To add a bot (for example SF orders), add the account in section 3 first (CSV customer ID + webhook), then pick it.
- If the chosen account is deleted or turned off, that login's requests stop with a clear message ("Ask Ray") rather
  than going to the wrong bot.

## 4b. Language (English / 中文)
- The **中文 / EN** button (top bar and sign-in screen) switches the whole app, Admin included. Each phone remembers
  its choice. The default is English.
- Item names, descriptions and customer notes are never translated.
- Client links shared in 中文 open in 中文. The client page has its own toggle too.

## 4c. Calculators
- **Tile** is sold by **pieces**. The calculator always rounds up to full boxes, then sets the qty in pieces
  (boxes × pcs/box, e.g. 8 boxes × 2 = 16 pcs) with a note like "100 sq ft + 10% · 8 boxes". If pcs/box is
  unknown, it rounds up pieces only.
- **Flooring** is sold by **boxes**. The sq ft per box comes from the description ("23.4 SF/BOX", "SQFT/CTN", …) and is
  always editable. A fix you make is remembered on that phone. The calculator shows price per box and per sq ft during
  price hours, and rounds up to whole boxes.
- Opened from a note line, either calculator writes the qty and sq ft note into that line as you type, and it autosaves.
  Tap **Done** or tap outside to close. Flooring never uses the tile calculator, and tile never uses the flooring one.

## 5. Sharing
- **With staff:** on a project, tap **Share**. Pick people of the same account, or "Everyone on my team". They can open,
  add items, edit and quote it. Only the owner (or an admin) changes sharing or deletes.
- **With a client:** tap **Share with client** → **Make client link** → **Copy link** or **Share…** (text it).
  The client sees a read-only page with the notes, items, qty, item notes, photos and our store addresses.
  **No prices, totals, stock or shelf locations ever.** No sign-in needed: anyone with the link can open it, so send it only to
  the client. **New link** replaces it (the old link stops at once). **Stop client link** turns it off. Deleting the project also
  kills the link.

## 6. Prices and data
- Prices show only during price hours (Mon–Sat 8:30–5:30 PT) or after an admin unlock. Outside those hours the server
  removes them.
- Item data (stock, shelves, incoming) is refreshed by Red from Ray's NetSuite item list. Discontinued styles are hidden
  with `hidden-prefixes.json` (ask Red to add one).

## 7. If something breaks
- "Not saved, tap to retry": check the internet and tap it. Nothing is lost on the phone.
- A bot didn't get a request: open **History → Requests**, open it and tap **Re-send**. In Admin, **Ping bot** that account.
- The app looks old after an update: close the home-screen app fully and open it again.
