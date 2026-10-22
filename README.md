# jaxanaa.github.io
This is my first simple website

## Multiplayer blackjack setup

The blackjack page uses Supabase Realtime so visitors can join the same table from different devices. To enable shared tables:

1. Create a Supabase project.
2. In the Supabase SQL Editor, run the contents of [`supabase-setup.sql`](./supabase-setup.sql).
3. In the project's API settings, copy its Project URL and **anon/public** key into [`supabase-config.js`](./supabase-config.js):

   ```js
   window.BLACKJACK_SUPABASE_URL = "https://your-project.supabase.co";
   window.BLACKJACK_SUPABASE_ANON_KEY = "your-anon-public-key";
   ```

4. Publish the site. Open **Blackjack**, create a table, and share the invite link or six-character code.

The anon key is designed to be used in a website; never put a Supabase `service_role` key in this repository. The setup SQL intentionally makes free-play rooms publicly readable and writable, so this game is for fun only. Do not use it for real money, prizes, or anything that needs tamper-proof scores.
