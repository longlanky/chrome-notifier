// End-to-end tests: loads the unpacked extension into Playwright's Chromium, with the PagerDuty API
// mocked out, and drives it through the service worker and options page.
//
// Tests share one browser and run in order, as each builds on the state left by the previous one.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'pd-notifier');
const API_KEY = 'GOODKEYGOODKEYGOODKE';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry an assertion until it passes, as the extension reacts to storage changes asynchronously.
async function eventually(fn, timeout = 5000)
{
    const start = Date.now();
    for (;;)
    {
        try { return await fn(); }
        catch (e) { if (Date.now() - start > timeout) { throw e; } }
        await sleep(100);
    }
}

// Mocked PagerDuty API state.
const requests = [];
let incidents = [];
let triggeredTotal = 3;

let context, sw, extId, profileDir;

before(async () =>
{
    profileDir = mkdtempSync(join(tmpdir(), 'pd-notifier-test-'));
    context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chromium', // Required for extensions in headless mode.
        headless: !process.env.HEADED,
        args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`]
    });

    await context.route(/^https:\/\/[^/]*pagerduty\.com\//, async (route) =>
    {
        const req = route.request();
        requests.push({ method: req.method(), url: req.url(), headers: await req.allHeaders() });

        const url = new URL(req.url());
        const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

        if (req.method() === 'PUT')
        {
            if (req.headers()['from']) { return json(200, { incident: {} }); }
            return json(400, { error: { message: 'You must specify a user\'s email address in the "From" header to perform this action' } });
        }
        if (url.pathname.endsWith('/users'))
        {
            return json((req.headers()['authorization'] || '').includes(API_KEY) ? 200 : 401, {});
        }
        if (url.searchParams.get('total') === 'true') { return json(200, { incidents: [], total: triggeredTotal }); }
        return json(200, { incidents });
    });

    [sw] = context.serviceWorkers();
    if (!sw) { sw = await context.waitForEvent('serviceworker'); }
    extId = new URL(sw.url()).host;
});

after(async () =>
{
    await context?.close();
    rmSync(profileDir, { recursive: true, force: true });
});

const getNotifications = () => sw.evaluate(() => chrome.notifications.getAll());
const lastRequest = (match) => requests.filter((r) => r.url.includes(match)).pop();

async function openOptions()
{
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/options/options.html`);
    await page.waitForFunction(() => document.getElementById('account-subdomain').value !== '' || document.readyState === 'complete');
    return page;
}

test('opens the options page on install', async () =>
{
    await eventually(() => assert.ok(context.pages().some((p) => p.url().endsWith('/options/options.html'))));
});

test('creates the toolbar context menu items', async () =>
{
    for (const id of ['pd_clear_all', 'pd_test_notification'])
    {
        const exists = await sw.evaluate((id) => new Promise((r) => chrome.contextMenus.update(id, {}, () => r(!chrome.runtime.lastError))), id);
        assert.ok(exists, id);
    }
});

test('does not poll until an account is configured', async () =>
{
    await sleep(500);
    assert.equal(requests.length, 0);
});

test('notifies for a triggered incident using the API key', async () =>
{
    incidents = [{ id: 'PINC1', summary: 'DB down', urgency: 'high', service: { summary: 'Database' } }];
    await sw.evaluate((key) => chrome.storage.local.set({ pdAPIKey: key }), API_KEY);
    await sw.evaluate(() => chrome.storage.sync.set({ pdAccountSubdomain: 'acme', pdShowBadgeUpdates: true, pdFilterServices: 'PSVC1,PSVC2' }));

    await eventually(async () => assert.ok('PINC1' in await getNotifications()));

    const req = lastRequest('since=');
    const url = new URL(req.url);
    assert.equal(url.origin + url.pathname, 'https://api.pagerduty.com/incidents');
    assert.deepEqual(url.searchParams.getAll('service_ids[]'), ['PSVC1', 'PSVC2']);
    assert.deepEqual(url.searchParams.getAll('urgencies[]'), ['high']);
    assert.equal(req.headers['authorization'], `Token token=${API_KEY}`);
});

test('shows the triggered count on the badge', async () =>
{
    await eventually(async () => assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '3'));
});

test('schedules the poll alarm at 30 seconds by default', async () =>
{
    const alarm = await sw.evaluate(() => chrome.alarms.get('pd-poll'));
    assert.equal(alarm.periodInMinutes, 0.5);
});

test('does not re-notify for an incident already shown', async () =>
{
    await sw.evaluate(() => chrome.notifications.clear('PINC1'));
    const before = requests.length;
    await sw.evaluate(() => chrome.storage.sync.set({ pdPollSeconds: 60 }));

    await eventually(() => assert.ok(requests.slice(before).some((r) => r.url.includes('since='))));
    await sleep(300);
    assert.ok(!('PINC1' in await getNotifications()));
});

test('reschedules the alarm when the poll interval changes', async () =>
{
    await eventually(async () => assert.equal((await sw.evaluate(() => chrome.alarms.get('pd-poll'))).periodInMinutes, 1));
});

test('plays a sound via an offscreen document for new incidents', async () =>
{
    incidents = [{ id: 'PINC2', summary: 'API slow', urgency: 'low', service: { summary: 'API' } }];
    await sw.evaluate(() => chrome.storage.sync.set({ pdNotifSound: true, pdIncludeLowUrgency: true }));

    await eventually(async () => assert.ok('PINC2' in await getNotifications()));
    await eventually(async () =>
    {
        const contexts = await sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }));
        assert.equal(contexts.length, 1);
    });
});

test('options page loads saved settings with the API key obfuscated', async () =>
{
    const page = await openOptions();
    await eventually(async () => assert.equal(await page.inputValue('#account-subdomain'), 'acme'));
    assert.equal(await page.inputValue('#api-key'), '••••••••••••••••' + API_KEY.slice(-4));
    assert.equal(await page.inputValue('#poll-seconds'), '60');
    await page.close();
});

test('options page rejects a subdomain that is not a plain subdomain', async () =>
{
    const page = await openOptions();
    await eventually(async () => assert.equal(await page.inputValue('#account-subdomain'), 'acme'));
    await page.fill('#account-subdomain', 'evil.com/x?');
    await page.click('#save');

    await eventually(async () => assert.ok(await page.$eval('#account-subdomain', (e) => e.classList.contains('bad'))));
    assert.equal((await sw.evaluate(() => chrome.storage.sync.get('pdAccountSubdomain'))).pdAccountSubdomain, 'acme');
    await page.close();
});

test('options page saves settings without touching an obfuscated key', async () =>
{
    const page = await openOptions();
    await eventually(async () => assert.equal(await page.inputValue('#account-subdomain'), 'acme'));
    await page.fill('#account-subdomain', ' Acme2 ');
    await page.fill('#from-email', 'me@example.com');
    await page.selectOption('#poll-seconds', '120');
    await page.click('#save');

    await eventually(async () =>
    {
        const saved = await sw.evaluate(() => chrome.storage.sync.get(null));
        assert.equal(saved.pdAccountSubdomain, 'acme2');
        assert.equal(saved.pdFromEmail, 'me@example.com');
        assert.equal(saved.pdPollSeconds, 120);
    });
    assert.ok(!(await page.$eval('#account-subdomain', (e) => e.classList.contains('bad'))));
    assert.equal((await sw.evaluate(() => chrome.storage.local.get('pdAPIKey'))).pdAPIKey, API_KEY);
    assert.equal((await sw.evaluate(() => chrome.storage.sync.get('pdAPIKey'))).pdAPIKey, undefined);
    await page.close();
});

test('validate button reports good and bad API keys', async () =>
{
    const page = await openOptions();
    await eventually(async () => assert.equal(await page.inputValue('#account-subdomain'), 'acme2'));

    await page.click('#api-validate');
    await eventually(async () => assert.equal(await page.$eval('#access-status', (e) => e.className), 'ok'));

    await page.fill('#api-key', 'BADKEYBADKEYBADKEYBA');
    await page.click('#api-validate');
    await eventually(async () => assert.equal(await page.$eval('#access-status', (e) => e.className), 'ko'));
    assert.match(await page.textContent('#access-status'), /Invalid API key/);
    await page.close();
});

test('PDAPI sends the From header on writes', async () =>
{
    const page = await openOptions();
    const result = await page.evaluate(async (key) =>
    {
        const { PDAPI } = await import('../lib/pd-api.js');
        const body = { incident: { type: 'incident_reference', status: 'acknowledged' } };
        const withEmail = await new PDAPI(key, { fromEmail: 'me@example.com' }).put('https://api.pagerduty.com/incidents/PINC2', body);
        const withoutEmail = await new PDAPI(key).put('https://api.pagerduty.com/incidents/PINC2', body);
        return [withEmail.status, withoutEmail.status];
    }, API_KEY);

    assert.deepEqual(result, [200, 400]);
    assert.equal(requests.filter((r) => r.method === 'PUT')[0].headers['from'], 'me@example.com');
    await page.close();
});

test('migrates an API key from sync to local storage', async () =>
{
    const page = await openOptions();
    await sw.evaluate(() => chrome.storage.local.remove('pdAPIKey'));
    await sw.evaluate(() => chrome.storage.sync.set({ pdAPIKey: 'OLDKEYOLDKEYOLDKEYOL' }));
    await page.evaluate(async () => { const { migrateAPIKey } = await import('../lib/config.js'); await migrateAPIKey(); });

    assert.equal((await sw.evaluate(() => chrome.storage.local.get('pdAPIKey'))).pdAPIKey, 'OLDKEYOLDKEYOLDKEYOL');
    assert.equal((await sw.evaluate(() => chrome.storage.sync.get('pdAPIKey'))).pdAPIKey, undefined);
    await page.close();
});

test('uses the subdomain session endpoint when there is no API key', async () =>
{
    await sleep(500); // Let polls from the previous test's storage changes finish.
    const before = requests.length;
    await sw.evaluate(() => chrome.storage.local.set({ pdAPIKey: '' }));

    await eventually(() =>
    {
        const req = requests.slice(before).filter((r) => r.url.includes('/incidents')).pop();
        assert.ok(req && req.url.startsWith('https://acme2.pagerduty.com/api/v1/incidents?'), req && req.url);
        assert.equal(req.headers['authorization'], undefined);
        assert.equal(req.headers['x-pagerduty-api-local'], '1');
    });
});

test('shows an error badge when the API fails', async () =>
{
    await context.unroute(/^https:\/\/[^/]*pagerduty\.com\//);
    await context.route(/^https:\/\/[^/]*pagerduty\.com\//, (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"Unauthorized"}}' }));
    await sw.evaluate(() => chrome.storage.sync.set({ pdFilterUsers: 'PUSR1' }));

    await eventually(async () => assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '!'));
});
