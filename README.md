# PagerDuty Chrome Notifier

A Google Chrome and Microsoft Edge extension to show PagerDuty notifications using the browser's notification API. The notification will display some information about the alert, along with buttons to acknowledge and resolve it right from the notification!

![An example of the notifications.](example.png)

All you need to do for it to work is to have an active session on your PagerDuty subdomain, or provide a PagerDuty API key for your account.

## Installing from Source
The extension uses Manifest V3 and requires Chrome or Edge 120 or newer. No build step or other tools are needed.

### 1. Get the files
1. On the GitHub page for this repository, click **Code → Download ZIP**.
2. Extract the zip (on Windows, right-click it and choose **Extract All…**) to a permanent location, such as `C:\Extensions\`. The browser loads the extension directly from this folder, so don't leave it in your Downloads folder. If the folder is moved or deleted, the extension stops working.

Alternatively, `git clone` the repository.

### 2. Load it into the browser
1. Open `edge://extensions` (Edge) or `chrome://extensions` (Chrome) in the address bar.
2. Turn on **Developer mode**. In Edge it's a toggle in the left sidebar (under the ☰ menu on narrow windows); in Chrome it's in the top-right corner.
3. Click **Load unpacked**.
4. Select the **`pd-notifier`** folder, which is the one containing `manifest.json`, e.g. `C:\Extensions\chrome-notifier-master\pd-notifier`. Selecting the outer folder gives a "Manifest file is missing" error.
5. The options page opens automatically. Enter your account subdomain and (optionally) API key, click **Save**, then click **Validate** to check access.

### 3. Pin the icon and test
1. Click the Extensions (puzzle piece) icon in the toolbar, then the pin/eye icon next to **PagerDuty Notifier**.
2. Right-click the pinned icon and choose **Show test notification**.

If the test notification doesn't appear on Windows:
* In **Settings → System → Notifications**, make sure the browser is allowed to show notifications and **Do not disturb** is off.
* Notifications are only shown while the browser is running, though it can be minimized.

### Updating
Download and extract the new version over the same folder, then click **Reload** on the extension's card in `edge://extensions` or `chrome://extensions`. Your settings are kept.

## Using an API Key
The extension can be used without having to provide an API key, however, in that case, it will only work if you have an active session for your PagerDuty domain. That means you must be logged into your domain, but you don't need to keep the tab open. Session-based access relies on PagerDuty's web app endpoints and browser cookie behaviour, so an API key is recommended for reliable notifications.

The API key is stored only in the browser's local extension storage, and is not synced to your other devices.

If you use an account-level (general access) API key, PagerDuty requires the email address of a PagerDuty user for any changes, so set **Your PagerDuty Login Email** to be able to acknowledge/resolve incidents. This isn't needed for personal user API keys.

If you decide to use an API key instead, you can use either a read-only key, or a read/write key. If you use a read-only key, then the Acknowledge and Resolve buttons will not function, as they would not have permission to update your incidents. If you prefer to use a read-only key, you can configure the extension to remove these action buttons from the notifications.

## Generating an API Key

See "[API Access Keys](https://support.pagerduty.com/docs/api-access-keys)" for instructions on how to get an API key.

## Configuration Options

* **Account Subdomain** - (Required) The subdomain for your PagerDuty account. If your account is https://example.pagerduty.com, you would use "example".
* **PagerDuty API Key** - (Optional) An API key for your PagerDuty account. If not provided, an active session on your subdomain is needed. If a read-only key is provided, then the Acknowledge/Resolve buttons will be non-functional.
* **Your PagerDuty Login Email** - (Optional) Required to acknowledge/resolve incidents when using an account-level API key.
* **Filter Users** - (Optional) A list of comma-separated user ID's, which will only trigger notifications for incidents assigned to those users.
* **Filter Teams** - (Optional) A list of comma-separated teams ID's, which will only trigger notifications for incidents assigned to escalation policies that belong to those teams.
* **Filter Services** - (Optional) A list of comma-separated service ID's, which will only trigger notifications for incidents that are part of those services.
* **Check for new incidents every** - How often to poll PagerDuty for new incidents (30 seconds to 5 minutes). Browsers don't allow extensions to wake up more often than every 30 seconds.
* **Include Low Urgency Alerts?** - If checked, then you will receive notifications for low urgency alerts.
* **Remove Ack/Resolve Buttons?** - If checked, the Acknowledge/Resolve buttons are removed from the notification. You should use this if you only wish to provide a read-only API key.
* **Open incident in new tab on acknowledge?** - If checked, whenever you click the "Acknowledge" button, the incident page will be opened in a new tab.
* **Require interaction to dismiss notification?** - If checked, the notification will remain on your desktop until you interact with it by clicking on an option. On macOS this depends on the notification style set for your browser in System Settings.
* **Play a notification sound?** - If checked, a short sound will play whenever a new notification is triggered.
* **Show triggered count on icon?** - If checked, the icon in your toolbar will show the number of triggered incidents matching your filters.

## Development
Requires Node.js 20 or newer.

```sh
npm install
npx playwright install chromium   # One-off download of the browser used by the tests.
npm test                          # Loads the extension in headless Chromium against a mocked PagerDuty API.
HEADED=1 npm test                 # Same, with a visible browser window.
npm run package                   # Builds dist/pd-notifier-<version>.zip for the Chrome Web Store / Edge Add-ons.
```

Bump `version` in `pd-notifier/manifest.json` before packaging a new release.

## License
[Apache 2](http://www.apache.org/licenses/LICENSE-2.0) (See LICENSE file)

## Contributing
1. Fork it ( https://github.com/PagerDuty/chrome-notifier/fork )
2. Create your feature branch (`git checkout -b my-new-feature`)
3. Commit your changes (`git commit -am 'Add some feature'`)
4. Push to the branch (`git push origin my-new-feature`)
5. Create a new Pull Request.
