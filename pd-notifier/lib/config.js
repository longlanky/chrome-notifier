// Shared configuration handling for the service worker and the options page.

// Allowed values (in seconds) for how often to poll. chrome.alarms can't fire more often than 30s.
export const POLL_INTERVALS = [30, 60, 120, 300];

// Settings stored in chrome.storage.sync (synced across the user's browsers).
export const SYNC_DEFAULTS = {
    pdAccountSubdomain: '',
    pdFromEmail: '',
    pdPollSeconds: 30,
    pdIncludeLowUrgency: false,
    pdRemoveButtons: false,
    pdOpenOnAck: false,
    pdNotifSound: false,
    pdRequireInteraction: false,
    pdFilterServices: '',
    pdFilterUsers: '',
    pdFilterTeams: '',
    pdShowBadgeUpdates: false,
    pdBadgeLocation: 'triggered'
};

// Settings stored in chrome.storage.local only. The API key is a secret, so it isn't synced.
export const LOCAL_DEFAULTS = {
    pdAPIKey: ''
};

// Split a comma-separated list of IDs, ignoring whitespace and empty entries.
function splitIds(value)
{
    return (value || '').split(',').map((s) => s.trim()).filter((s) => s !== '');
}

// Load all configuration into a single object.
export async function loadConfig()
{
    const [sync, local] = await Promise.all([
        chrome.storage.sync.get(SYNC_DEFAULTS),
        chrome.storage.local.get(LOCAL_DEFAULTS)
    ]);

    return {
        account:            (sync.pdAccountSubdomain || '').toLowerCase(),
        apiKey:             local.pdAPIKey || null,
        fromEmail:          sync.pdFromEmail || null,
        pollSeconds:        POLL_INTERVALS.includes(sync.pdPollSeconds) ? sync.pdPollSeconds : SYNC_DEFAULTS.pdPollSeconds,
        includeLowUrgency:  sync.pdIncludeLowUrgency,
        removeButtons:      sync.pdRemoveButtons,
        openOnAck:          sync.pdOpenOnAck,
        notifSound:         sync.pdNotifSound,
        requireInteraction: sync.pdRequireInteraction,
        filterServices:     splitIds(sync.pdFilterServices),
        filterUsers:        splitIds(sync.pdFilterUsers),
        filterTeams:        splitIds(sync.pdFilterTeams),
        showBadgeUpdates:   sync.pdShowBadgeUpdates,
        badgeLocation:      sync.pdBadgeLocation || 'triggered'
    };
}

// Older versions kept the API key in chrome.storage.sync. Move it to local storage.
export async function migrateAPIKey()
{
    const { pdAPIKey } = await chrome.storage.sync.get('pdAPIKey');
    if (pdAPIKey === undefined) { return; }

    const local = await chrome.storage.local.get(LOCAL_DEFAULTS);
    if (pdAPIKey && !local.pdAPIKey) { await chrome.storage.local.set({ pdAPIKey: pdAPIKey }); }
    await chrome.storage.sync.remove('pdAPIKey');
}
