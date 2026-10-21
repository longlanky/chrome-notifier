// This provides all of the logic for handling user configuration of the extension.

import { isValidSubdomain, isValidAPIKey, isValidEmail } from '../lib/pd-api.js';
import { SYNC_DEFAULTS, LOCAL_DEFAULTS } from '../lib/config.js';

const OBFUSCATION = '••••••••••••••••';

// Helper functions to obfuscate the API key on the UI, and detect if it's obfuscated.
export function obfuscateAPIKey(key)
{
    if (!key) { return ''; }
    return OBFUSCATION + key.slice(-4);
}
export function isAPIKeyObfuscated(key)
{
    return key.startsWith(OBFUSCATION);
}

// Wrapper method to get the element of a field from the page.
export function getElement(elementId)
{
    return document.getElementById(elementId);
}

// Add an event listener to restore previously save configuration.
document.addEventListener('DOMContentLoaded', async function ()
{
    const [items, local] = await Promise.all([
        chrome.storage.sync.get(SYNC_DEFAULTS),
        chrome.storage.local.get(LOCAL_DEFAULTS)
    ]);

    // Update the page elements appropriately.
    getElement('account-subdomain').value     = items.pdAccountSubdomain;
    getElement('api-key').value               = obfuscateAPIKey(local.pdAPIKey);
    getElement('from-email').value            = items.pdFromEmail;
    getElement('poll-seconds').value          = String(items.pdPollSeconds);
    getElement('low-urgency').checked         = items.pdIncludeLowUrgency;
    getElement('remove-buttons').checked      = items.pdRemoveButtons;
    getElement('open-on-ack').checked         = items.pdOpenOnAck;
    getElement('notif-sound').checked         = items.pdNotifSound;
    getElement('require-interaction').checked = items.pdRequireInteraction;
    getElement('filter-services').value       = items.pdFilterServices || '';
    getElement('filter-users').value          = items.pdFilterUsers || '';
    getElement('filter-teams').value          = items.pdFilterTeams || '';
    getElement('show-badge').checked          = items.pdShowBadgeUpdates;
    getElement('badge-location').value        = items.pdBadgeLocation || 'triggered';

    // Fall back to the default if the stored value isn't one of the options.
    if (!getElement('poll-seconds').value) { getElement('poll-seconds').value = String(SYNC_DEFAULTS.pdPollSeconds); }
});

// Add an event listener to save the current configuration, will validate it first.
getElement('save').addEventListener('click', async function ()
{
    if (!validateConfiguration()) { return; }

    // If API key was updated, set it. If still obfuscated, don't.
    const apiKey = getElement('api-key').value;
    if (!isAPIKeyObfuscated(apiKey))
    {
        await chrome.storage.local.set({ pdAPIKey: apiKey });
    }

    await chrome.storage.sync.set(
    {
        pdAccountSubdomain:   getElement('account-subdomain').value,
        pdFromEmail:          getElement('from-email').value,
        pdPollSeconds:        parseInt(getElement('poll-seconds').value, 10),
        pdIncludeLowUrgency:  getElement('low-urgency').checked,
        pdRemoveButtons:      getElement('remove-buttons').checked,
        pdOpenOnAck:          getElement('open-on-ack').checked,
        pdNotifSound:         getElement('notif-sound').checked,
        pdRequireInteraction: getElement('require-interaction').checked,
        pdFilterServices:     getElement('filter-services').value,
        pdFilterUsers:        getElement('filter-users').value,
        pdFilterTeams:        getElement('filter-teams').value,
        pdShowBadgeUpdates:   getElement('show-badge').checked,
        pdBadgeLocation:      getElement('badge-location').value
    });

    // The service worker picks up storage changes itself, so just let the user know things saved.
    getElement('saved').className = 'saved';
    setTimeout(function() { getElement('saved').className = ''; }, 3000);
});

// Mark a field as valid or invalid, returning whether it was valid.
function markField(element, isValid)
{
    element.classList.toggle('bad', !isValid);
    return isValid;
}

// This will validate that our configuration is usable.
function validateConfiguration()
{
    let isValid = true;

    // Subdomain is required, and must be a plain subdomain (not a URL).
    const subdomain = getElement('account-subdomain');
    subdomain.value = subdomain.value.trim().toLowerCase();
    isValid = markField(subdomain, isValidSubdomain(subdomain.value)) && isValid;

    // API key is optional, but must look like a key if provided.
    const apiKey = getElement('api-key');
    apiKey.value = apiKey.value.trim();
    isValid = markField(apiKey, apiKey.value === '' || isAPIKeyObfuscated(apiKey.value) || isValidAPIKey(apiKey.value)) && isValid;

    // Email is optional.
    const fromEmail = getElement('from-email');
    fromEmail.value = fromEmail.value.trim();
    isValid = markField(fromEmail, fromEmail.value === '' || isValidEmail(fromEmail.value)) && isValid;

    // Filters are comma-separated IDs, with no spaces.
    ['filter-services', 'filter-users', 'filter-teams'].forEach(function(id)
    {
        const e = getElement(id);
        e.value = e.value.replace(/\s+/g, '').replace(/^,+|,+$/g, '');
        isValid = markField(e, /^[A-Za-z0-9,]*$/.test(e.value)) && isValid;
    });

    return isValid;
}
