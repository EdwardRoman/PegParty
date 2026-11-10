# PegParty

PegParty is a Chrome extension for watching 67movies together. It opens in
a dropdown beneath Chrome’s toolbar icon. The party keeps syncing when the
dropdown closes, including when the video enters fullscreen. Anyone in the party can play, pause, seek, or change the
speed with the movie’s regular controls. Each person streams the movie directly
from the watch page.

## Install

On both computers, extract the ZIP, open `chrome://extensions`, enable
**Developer mode**, and use **Load unpacked** to select `PegParty/extension`.
Pin **PegParty** from Chrome’s extensions menu. If you have the older
**67 Watch Party** extension enabled, disable it to avoid controlling the same
video twice. Only the person running the relay needs Node.js 22 or newer.

## Chat and profiles

Open **Your profile** in the toolbar dropdown to save your display name, name
color, and avatar on this browser. Upload a PNG, JPEG, WebP, or GIF, then
click **Save profile**. PegParty uses a small square thumbnail for the avatar.

After joining or creating a party, click the **‹** arrow on the right edge
to open chat beside the resized player. Click **›** beside the chat to restore
the player's original width. In narrow windows, chat can go below the player.
If the player is still loading, the chat is available at the right edge of
the page and docks beside the player as soon as it is found.

Use the player's fullscreen button for fullscreen with chat and message
previews when the site fullscreen target is a player container. The chat
composer keeps typed keys separate from player shortcuts. If a site uses
video-only fullscreen, use the browser's fullscreen mode (F11 on Windows)
to keep the chat visible.

Use **Members** to see everyone in the room. The feed shows messages and who
joined, left, paused, resumed, skipped, or changed speed. New messages from
other members briefly appear near the top of the video while chat is closed.
The relay keeps the latest 100 entries in memory for the life of the room.

## GitHub releases and update checks

The toolbar footer shows the installed version and a **Get update** link
when GitHub has a newer full release. If you installed the ZIP outside
GitHub and haven't set a release source yet, use **Set GitHub source** in
the footer and enter the public `owner/repository`. Download and reload
updates manually from the browser's extensions page.

## Update the hosted relay for chat

This build uses `https://pegparty-relay.onrender.com` by default. If the
dropdown says **Chat requires the relay update**, replace the relay's existing
`server.mjs` in the GitHub repository connected to Render with the copy from
this ZIP. Keep the same Render service and start command. Once it redeploys,
open `https://pegparty-relay.onrender.com/health` and look for `"chat":true`.
Both viewers should update their extensions and start a new party.

## Host a party from Windows

Use the hosted relay above for 67movies. The following local steps are for
development or the bundled demo. A custom remote relay requires changing the
default in `extension/config.js`.

1. From the extracted `PegParty` folder, start the updated relay in PowerShell.

   ```powershell
   node relay/server.mjs
   ```

   If port 8787 is already in use by the old relay, stop it with **Ctrl+C**
   before starting PegParty.

2. Start your Cloudflare tunnel in a second PowerShell window.

   ```powershell
   .\cloudflared-windows-amd64.exe tunnel --url http://127.0.0.1:8787
   ```

3. Open the public HTTPS URL printed by Cloudflare with `/pegparty/setup`
   added. For example, `https://your-tunnel.trycloudflare.com/pegparty/setup`.
   Click the **PegParty** icon, then **Use this relay**. Approve access when
   Chrome asks. If the permission prompt closes the dropdown, reopen it
   and click **Use this relay** again. Repeat this step when your temporary
   Cloudflare URL changes.
4. Open a movie, start its video, and click **PegParty**. If the player is
   embedded, select its domain and click **Allow player**. Then click
   **Create party** and **Copy invite link**.
5. Send your guest the invite link. Keep the relay and tunnel running during the party. You can close the
   dropdown once the party starts.

## Join a party

1. Open the invite link in Chrome. It opens the movie directly.
2. Click the **PegParty** toolbar icon to open the dropdown. Start the video
   once so the site loads its player. If PegParty asks, approve the embedded
   player domain and the party connection.
3. Click **Join party**, then close the dropdown or go fullscreen. Anyone can
   use the movie’s play, pause, seek, and speed controls. Reopen the dropdown
   to copy an invite, **Resync** your player to the party, or **Leave**.
   Closing the movie tab or navigating away from the movie ends your connection.

If Chrome blocks an automatic resume, PegParty asks you to press **Play** on
the video itself. If you see a different video length or trouble connecting
to the player, use the same playback server as the person who sent the invite.

## Use a permanent connection

To use a different permanent relay, deploy the included Node relay at a stable
HTTPS origin and set that origin in `extension/config.js` before distributing
the extension. A public host can use `HOST=0.0.0.0` and the supplied `PORT`
environment variable. Use `/health` for the health check and terminate HTTPS
at the host or reverse proxy. Run one instance because parties are in memory.
The guest gets the connection from the invite. The relay carries playback
positions, a hash of the watch-page URL, and the room's chat and profiles.

## Try the bundled demo

Start the local relay, open `http://127.0.0.1:8787/demo`, and create a party.
Open its invite link in a second tab and join. Close both dropdowns, then
play, pause, and seek from either tab. Reopen a dropdown to check your party.
