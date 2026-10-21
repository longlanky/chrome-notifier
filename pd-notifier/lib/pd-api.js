// Helper wrappers for PagerDuty API methods.

// The official REST API host, used whenever an API key is provided.
export const API_HOST = 'https://api.pagerduty.com';

// Subdomains are interpolated into hostnames, so be strict to avoid sending requests (and API keys)
// anywhere other than *.pagerduty.com.
export function isValidSubdomain(subdomain)
{
    return typeof subdomain === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(subdomain);
}

// API keys are opaque tokens. Only require printable, non-space ASCII of a sensible length.
export function isValidAPIKey(key)
{
    return typeof key === 'string' && /^[\x21-\x7E]{16,128}$/.test(key);
}

export function isValidEmail(email)
{
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+$/.test(email);
}

export class PDAPI
{
    // apiKey:    Optional API key. If not provided, the browser session cookie is used instead.
    // version:   REST API version to request in the Accept header.
    // fromEmail: Email of a PagerDuty user, required by account-level API keys for write requests.
    constructor(apiKey, { version = 2, fromEmail = null } = {})
    {
        this.apiKey    = isValidAPIKey(apiKey) ? apiKey : null;
        this.version   = version;
        this.fromEmail = isValidEmail(fromEmail) ? fromEmail : null;
        this.userAgent = 'pd-chrome-notifier-' + chrome.runtime.getManifest().version; // Will be in the X-Requested-With header of requests.
    }

    // Perform a request. Never throws; resolves to { ok, status, data }, where status is 0 for
    // network errors and data is the parsed JSON body (or null).
    async request(method, url, body = null)
    {
        const headers = {
            'X-Requested-With': this.userAgent,
            'Accept': 'application/vnd.pagerduty+json;version=' + this.version
        };

        // If we have a valid API key, authenticate using that. Otherwise rely on the session cookie.
        if (this.apiKey)
        {
            headers['Authorization'] = 'Token token=' + this.apiKey;
        }
        else
        {
            headers['X-PagerDuty-Api-Local'] = '1';
        }

        if (body !== null)
        {
            headers['Content-Type'] = 'application/json';
            if (this.fromEmail) { headers['From'] = this.fromEmail; }
        }

        try
        {
            const response = await fetch(url, {
                method:      method,
                headers:     headers,
                body:        body === null ? undefined : JSON.stringify(body),
                credentials: this.apiKey ? 'omit' : 'include'
            });

            let data = null;
            try { data = await response.json(); } catch (e) {}

            return { ok: response.ok, status: response.status, data: data };
        }
        catch (e)
        {
            return { ok: false, status: 0, data: null };
        }
    }

    get(url)
    {
        return this.request('GET', url);
    }

    put(url, body)
    {
        return this.request('PUT', url, body);
    }
}
