# Pilot log receiver (Google Sheets)

`Code.gs` turns a Google Sheet into the pilot's log endpoint. The app sends events in small batches, and the script writes them to three tabs:

- **Events:** every event, one row each, with any extra details as JSON in the last column.
- **Scratches:** one row per card revealed, with grade, σ, holo, print number, ceiling breaks, scratch time, stroke speed, and where the card came from.
- **Summary:** refreshed every hour, or on demand from the **Pecan Pie** menu. It shows retention by day since first open, daily activity, cards per session, condition grades by rank, care by rank, card sources, and outlier counts. Test cards from the Debug tab are left out.

## Setup (about five minutes)

1. Create a new Google Sheet and name it something like "Pecan Pie pilot log".
2. Open **Extensions › Apps Script**. Delete the starter code, paste in all of `Code.gs`, and save.
3. Choose `setup` in the function menu at the top and click **Run**.
   - Google asks you to authorize the script. Pick your account. On the "Google hasn't verified this app" screen, click **Advanced**, then **Go to (project name)**. This is your own script, so that's expected.
   - `setup` creates the tabs and an hourly trigger for the summary.
4. Click **Deploy › New deployment**. Choose the gear icon, then **Web app**, and set:
   - **Execute as:** Me
   - **Who has access:** Anyone
5. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.
6. Put that URL in `js/config.js` as `logEndpoint` and push, so every tester's app sends to it.
   - To try it on just your own phone first, paste it into **Debug › Log endpoint** instead.

To check it's running, open the URL in a browser. It should say "Pecan Pie log receiver is running."

## Notes

- **Updating the script:** after editing `Code.gs`, use **Deploy › Manage deployments**, edit the existing deployment, and choose **New version**. Keep the same URL so the app doesn't need changing.
- **Privacy:** events carry a random tester code (shown at the bottom of the Collection screen), the tester's local date, and gameplay details. No coordinates or personal information are sent.
- **Abuse:** the endpoint is public, since the app is a public web page. The script caps payload size and batch length, drops repeated events, and stops text from being read as a spreadsheet formula. For a 20 to 30 person pilot that's enough. Anything larger should move to a real backend with authentication.
- **Duplicates:** each event has an `id`, and repeats received within six hours are dropped. If one slips through anyway, remove duplicates by the `id` column.
