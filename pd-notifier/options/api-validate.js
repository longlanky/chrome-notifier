// These functions will allow us to validate the API access, so people can self-debug any incorrect credentials.

import { PDAPI, API_HOST, isValidSubdomain, isValidAPIKey } from '../lib/pd-api.js';
import { LOCAL_DEFAULTS } from '../lib/config.js';
import { getElement, isAPIKeyObfuscated } from './options.js';

// Status message updater helpers.
function setStatus(className, message)
{
    getElement('access-status').className = className;
    getElement('access-status').textContent = message;
}

function statusError(message = '')
{
    setStatus('ko', '✗ ' + message);
}

function statusOK(message = '')
{
    setStatus('ok', '✓ ' + message);
}

function statusWarning(message = '')
{
    setStatus('warn', '⚠ ' + message);
}

async function validateAPIKeyAccess(apiKey, subdomain)
{
    // Validate if they can access the API using the API key.
    if (apiKey)
    {
        if (!isValidAPIKey(apiKey)) { statusError('Invalid API key! (Contains invalid chars?)'); return; }

        const response = await new PDAPI(apiKey).get(API_HOST + '/users?limit=1');
        if (response.ok) { statusOK(); return; }
        if (response.status === 0) { statusError('Unable to reach PagerDuty'); return; }
    }

    // If we get to here, then API key is invalid (or not supplied). Validate if cookie auth is working.
    if (!isValidSubdomain(subdomain)) { statusError('Account not valid, check subdomain'); return; }

    // Don't pass an API key, will attempt cookie auth using their subdomain.
    const response = await new PDAPI(null).get('https://' + subdomain + '.pagerduty.com/api/v1/users?limit=1');
    if (response.ok)
    {
        // If HTTP200 and 2007 error code returned, then subdomain is invalid. Flag that up.
        if (response.data && response.data.error && response.data.error.code == 2007)
        {
            statusError('Account not valid, check subdomain');
            return;
        }

        // Otherwise, cookie auth is good.
        if (apiKey) { statusWarning('Invalid API key! (Cookie auth is OK)'); }
        else        { statusOK('Using browser session'); }
        return;
    }

    // Cookie auth was bad, enumerate the reasons.
    const prefix = apiKey ? 'Invalid API key! ' : 'No API key, and ';
    if (response.status === 0)   { statusError('Unable to reach PagerDuty'); return; }
    if (response.status === 401) { statusError(prefix + '(Not logged in for cookie auth)'); return; }
    if (response.status === 403) { statusError('Not authorized to access the API'); return; }
    if (response.status === 404) { statusError('Account not valid, check subdomain'); return; }
    statusError('Access Denied (' + response.status + '). Unable to access using API key or cookie auth');
}

// Add ability to validate API key access, so people can test themselves.
getElement('api-validate').addEventListener('click', async function ()
{
    // Clear any old status
    setStatus('loading', '');

    const subdomain = getElement('account-subdomain').value.trim().toLowerCase();

    // If API key in field is new, use that. Otherwise, use the API key we have in storage.
    let apiKey = getElement('api-key').value.trim();
    if (isAPIKeyObfuscated(apiKey))
    {
        apiKey = (await chrome.storage.local.get(LOCAL_DEFAULTS)).pdAPIKey;
    }

    await validateAPIKeyAccess(apiKey, subdomain);
});
