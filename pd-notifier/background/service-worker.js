// Service worker to poll the PagerDuty API for new incidents, and trigger a notification for any it
// finds. Will also give user ability to ack/resolve incidents right from the notifs.
//
// The service worker is shut down whenever it's idle, so no state is kept in memory between events.
// Polling is driven by a chrome.alarms alarm, and anything that needs to survive lives in storage.

import { PDAPI, API_HOST, isValidSubdomain } from '../lib/pd-api.js';
import { loadConfig, migrateAPIKey } from '../lib/config.js';

const POLL_ALARM        = 'pd-poll';
const POLL_OVERLAP_MS   = 5 * 1000;       // Re-check a few seconds before the last poll to cover clock skew.
const MAX_LOOKBACK_MS   = 10 * 60 * 1000; // Never look back further than this (e.g. after the browser was closed).
const MAX_NOTIFIED_IDS  = 200;            // How many already-notified incident IDs to remember.
const TEST_NOTIF_ID     = 'test';
const ERROR_NOTIF_PREFIX = 'pd-error-';

// Storage keys used for bookkeeping, as opposed to user configuration.
const STATE_KEYS = ['pdLastPollAt', 'pdNotifiedIds'];

// URL helpers
// -------------------------------------------------------------------------------------------------

// Base URL for REST API calls. With an API key we use the official API host, otherwise we go via the
// account subdomain so that the user's session cookie is used.
function apiBase(config)
{
    return config.apiKey ? API_HOST : 'https://' + config.account + '.pagerduty.com/api/v1';
}

// Base URL for the PagerDuty web UI.
function webBase(config)
{
    return 'https://' + config.account + '.pagerduty.com';
}

// Build an incidents URL, including the user's filters.
function incidentsUrl(config, params)
{
    const url = new URL(apiBase(config) + '/incidents');
    for (const [key, value] of Object.entries(params)) { url.searchParams.append(key, value); }

    // Limit to high urgency if that's all the user wants.
    if (!config.includeLowUrgency) { url.searchParams.append('urgencies[]', 'high'); }

    config.filterServices.forEach((id) => url.searchParams.append('service_ids[]', id));
    config.filterUsers.forEach((id) => url.searchParams.append('user_ids[]', id));
    config.filterTeams.forEach((id) => url.searchParams.append('team_ids[]', id));

    return url.toString();
}

function apiFor(config)
{
    return new PDAPI(config.apiKey, { fromEmail: config.fromEmail });
}

// Polling
// -------------------------------------------------------------------------------------------------

// Make sure the poll alarm exists and matches the configured interval.
async function ensureAlarm(config)
{
    const periodInMinutes = config.pollSeconds / 60;
    const alarm = await chrome.alarms.get(POLL_ALARM);
    if (alarm && alarm.periodInMinutes === periodInMinutes) { return; }

    await chrome.alarms.create(POLL_ALARM, { periodInMinutes: periodInMinutes, delayInMinutes: periodInMinutes });
}

// Only allow one poll at a time, so overlapping triggers can't produce duplicate notifications.
let currentPoll = null;
function poll()
{
    if (!currentPoll)
    {
        currentPoll = doPoll().finally(() => { currentPoll = null; });
    }
    return currentPoll;
}

async function doPoll()
{
    const config = await loadConfig();

    // If no account set up (first install), then do nothing. User will need to add config. Once they
    // save, a storage change will be picked up and things will kick off.
    if (!isValidSubdomain(config.account))
    {
        await chrome.action.setBadgeText({ text: '' });
        return;
    }

    const api = apiFor(config);
    await Promise.all([
        pollNewIncidents(config, api),
        updateToolbarBadge(config, api)
    ]);
}

// Fetch incidents triggered since we last polled, and show a notification for any new ones.
async function pollNewIncidents(config, api)
{
    const now = Date.now();
    const state = await chrome.storage.local.get({ pdLastPollAt: null, pdNotifiedIds: [] });

    // We only want incidents triggered since we last polled.
    const lastPollAt = state.pdLastPollAt || (now - config.pollSeconds * 1000);
    const since = Math.max(now - MAX_LOOKBACK_MS, lastPollAt - POLL_OVERLAP_MS);

    const url = incidentsUrl(config, {
        'statuses[]': 'triggered',
        'since':      new Date(since).toISOString(),
        'limit':      5 // More than this would be silly to show notifications for.
    });

    const response = await api.get(url);
    if (!response.ok || !response.data || !Array.isArray(response.data.incidents))
    {
        // Don't advance pdLastPollAt, so the next poll covers this window again.
        console.error('PagerDuty API returned an error while polling for new incidents.', {
            api_url: url,
            status: response.status,
            error_returned: response.data && response.data.error
        });
        return;
    }

    const notifiedIds = state.pdNotifiedIds;
    const newIncidents = response.data.incidents.filter((incident) => !notifiedIds.includes(incident.id));

    newIncidents.forEach((incident) => notifiedIds.push(incident.id));
    await chrome.storage.local.set({
        pdLastPollAt:  now,
        pdNotifiedIds: notifiedIds.slice(-MAX_NOTIFIED_IDS)
    });

    for (const incident of newIncidents) { await triggerNotification(config, incident, false); }

    // Only play the sound once per poll, rather than once per incident.
    if (newIncidents.length > 0 && config.notifSound) { await playSound(); }
}

// This will update the icon badge in the toolbar.
async function updateToolbarBadge(config, api)
{
    if (!config.showBadgeUpdates)
    {
        await chrome.action.setBadgeText({ text: '' });
        return;
    }

    // Check for any triggered incidents at all that follow our filters.
    const url = incidentsUrl(config, { 'statuses[]': 'triggered', 'total': 'true', 'limit': 1 });
    const response = await api.get(url);

    // If there was an error in the response, show "!" and log it.
    if (!response.ok || !response.data || response.data.error)
    {
        console.error('PagerDuty API returned an error while getting the incident count for the toolbar icon.', {
            api_url: url,
            status: response.status,
            error_returned: response.data && response.data.error
        });
        await chrome.action.setBadgeText({ text: '!' });
        await chrome.action.setBadgeBackgroundColor({ color: [90, 90, 90, 255] });
        await chrome.action.setTitle({ title: 'PagerDuty Notifier: unable to reach PagerDuty (HTTP ' + response.status + ')' });
        return;
    }

    await chrome.action.setTitle({ title: 'PagerDuty Notifier' });

    // If there are no incidents, show nothing on badge.
    const total = response.data.total;
    if (!total)
    {
        await chrome.action.setBadgeText({ text: '' });
        return;
    }

    // Otherwise, we have incidents, show the count.
    await chrome.action.setBadgeText({ text: total > 999 ? '999+' : String(total) });
    await chrome.action.setBadgeBackgroundColor({ color: [189, 0, 0, 255] });
}

// Notifications
// -------------------------------------------------------------------------------------------------

// This will trigger the actual notification based on an incident object.
async function triggerNotification(config, incident, withSound = true)
{
    // Define the buttons to show in the notification. Will be empty if user asked to remove.
    const buttons = config.removeButtons ? [] : [
        {
            title: 'Acknowledge',
            iconUrl: chrome.runtime.getURL('images/icon-acknowledge.png')
        },
        {
            title: 'Resolve',
            iconUrl: chrome.runtime.getURL('images/icon-resolve.png')
        }
    ];

    const urgency = incident.urgency || 'high';
    await chrome.notifications.create(incident.id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('images/icon-256.png'),
        title: incident.summary || 'PagerDuty incident',
        message: 'Service: ' + (incident.service ? incident.service.summary : 'Unknown'),
        contextMessage: urgency.charAt(0).toUpperCase() + urgency.slice(1) + ' Urgency',
        priority: 0,
        buttons: buttons,
        requireInteraction: config.requireInteraction
    });

    // Trigger notification sound if user wants it.
    if (withSound && config.notifSound) { await playSound(); }
}

// Show a short notification letting the user know something went wrong.
async function showErrorNotification(title, message)
{
    await chrome.notifications.create(ERROR_NOTIF_PREFIX + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('images/icon-256.png'),
        title: title,
        message: message,
        priority: 0
    });
}

// Turn a failed API response into something the user can act on.
function describeFailure(response)
{
    const error = (response.data && response.data.error) || {};
    const detail = [error.message].concat(error.errors || []).filter(Boolean).join(' ');

    if (response.status === 0)   { return 'Could not reach PagerDuty. Check your network connection.'; }
    if (/from/i.test(detail))    { return 'Set your PagerDuty login email on the options page (required for account API keys).'; }
    if (response.status === 401) { return 'Not authorized. Check your API key, or log in to PagerDuty.'; }
    if (response.status === 403) { return 'Permission denied. Are you using a read-only API key?'; }
    return 'PagerDuty returned HTTP ' + response.status + (detail ? ': ' + detail : '.');
}

function isIncidentNotification(notificationId)
{
    return notificationId !== TEST_NOTIF_ID && !notificationId.startsWith(ERROR_NOTIF_PREFIX);
}

// Update an incident's status, and tell the user if it didn't work.
async function updateIncidentStatus(config, incidentId, status)
{
    const response = await apiFor(config).put(apiBase(config) + '/incidents/' + encodeURIComponent(incidentId), {
        incident: { type: 'incident_reference', status: status }
    });

    if (!response.ok)
    {
        const action = status === 'acknowledged' ? 'acknowledge' : 'resolve';
        await showErrorNotification("Couldn't " + action + ' incident', describeFailure(response));
    }
}

// This will handle the event triggered from clicking one of the notification's buttons.
async function handleButtonClicked(notificationId, buttonIndex)
{
    await chrome.notifications.clear(notificationId);
    if (!isIncidentNotification(notificationId)) { return; } // Ignore for test/error notifications.

    const config = await loadConfig();
    if (!isValidSubdomain(config.account)) { return; }

    switch (buttonIndex)
    {
        case 0: // Acknowledge
            if (config.openOnAck) { await openIncident(config, notificationId); }
            await updateIncidentStatus(config, notificationId, 'acknowledged');
            break;

        case 1: // Resolve
            await updateIncidentStatus(config, notificationId, 'resolved');
            break;
    }

    await updateToolbarBadge(config, apiFor(config)); // Force a badge update, so it changes quickly.
}

// This will handle the event triggered when clicking on the main notification area.
async function handleNotificationClicked(notificationId)
{
    await chrome.notifications.clear(notificationId);
    if (!isIncidentNotification(notificationId)) { return; } // Ignore for test/error notifications.

    const config = await loadConfig();
    if (!isValidSubdomain(config.account)) { return; }
    await openIncident(config, notificationId);
}

async function openIncident(config, incidentId)
{
    await chrome.tabs.create({ url: webBase(config) + '/incidents/' + encodeURIComponent(incidentId) });
}

// This will open a tab to the dashboard using the relevant user settings.
async function openDashboard()
{
    const config = await loadConfig();
    if (!isValidSubdomain(config.account))
    {
        await chrome.runtime.openOptionsPage();
        return;
    }

    // Determine the correct URL based on user's options.
    const statuses = {
        open:         '?status=triggered,acknowledged',
        triggered:    '?status=triggered',
        acknowledged: '?status=acknowledged',
        any:          '?status=acknowledged,triggered,resolved'
    }[config.badgeLocation] || '';

    await chrome.tabs.create({ url: webBase(config) + '/incidents' + statuses });
}

async function clearAllNotifications()
{
    const notifs = await chrome.notifications.getAll();
    await Promise.all(Object.keys(notifs).map((id) => chrome.notifications.clear(id)));
}

// Sound
// -------------------------------------------------------------------------------------------------

// Service workers can't play audio, so it's done from an offscreen document.
const OFFSCREEN_URL = 'offscreen/offscreen.html';
let creatingOffscreen = null;

async function ensureOffscreenDocument()
{
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
    });
    if (contexts.length > 0) { return; }

    if (!creatingOffscreen)
    {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: OFFSCREEN_URL,
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Play a sound when a new PagerDuty incident notification is shown.'
        }).finally(() => { creatingOffscreen = null; });
    }
    await creatingOffscreen;
}

async function playSound()
{
    try
    {
        await ensureOffscreenDocument();
        await chrome.runtime.sendMessage({ target: 'offscreen', type: 'play-sound' });
    }
    catch (e)
    {
        console.error('Unable to play notification sound.', e);
    }
}

// Event listeners. These must all be registered synchronously at the top level.
// -------------------------------------------------------------------------------------------------

chrome.notifications.onButtonClicked.addListener(handleButtonClicked);
chrome.notifications.onClicked.addListener(handleNotificationClicked);

// Clicking the toolbar icon opens the dashboard.
chrome.action.onClicked.addListener(openDashboard);

chrome.runtime.onInstalled.addListener(async (details) =>
{
    // Context menus persist across restarts, so (re)create them once per install/update.
    await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
    chrome.contextMenus.create({
        title: 'Clear all notifications',
        id: 'pd_clear_all',
        contexts: ['action']
    });
    chrome.contextMenus.create({
        title: 'Show test notification',
        id: 'pd_test_notification',
        contexts: ['action']
    });

    // If this is the first installation, show the options page so user can set up their settings.
    if (details.reason === 'install') { await chrome.runtime.openOptionsPage(); }
    if (details.reason === 'update')  { await migrateAPIKey(); }

    await ensureAlarm(await loadConfig());
    await poll();
});

chrome.runtime.onStartup.addListener(async () =>
{
    await ensureAlarm(await loadConfig());
    await poll();
});

chrome.contextMenus.onClicked.addListener(async (info) =>
{
    switch (info.menuItemId)
    {
        case 'pd_clear_all':
            await clearAllNotifications();
            break;

        case 'pd_test_notification':
            await triggerNotification(await loadConfig(), {
                id: TEST_NOTIF_ID,
                summary: 'Test Notification',
                service: { summary: 'Test Service' },
                urgency: 'high'
            });
            break;
    }
});

chrome.alarms.onAlarm.addListener(async (alarm) =>
{
    if (alarm.name === POLL_ALARM) { await poll(); }
});

// When the user saves new options, reschedule and poll straight away so changes take effect.
chrome.storage.onChanged.addListener(async (changes, areaName) =>
{
    if (areaName !== 'sync' && areaName !== 'local') { return; }
    if (Object.keys(changes).every((key) => STATE_KEYS.includes(key))) { return; }

    await ensureAlarm(await loadConfig());
    await poll();
});
