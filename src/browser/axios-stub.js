/**
 * Fetch-based axios stub for browser builds.
 *
 * Implements the subset of the axios API used by this project:
 *   • axios.post(url, data?, config?)          – used by SalesforceAuthenticator
 *   • axios.create({ baseURL, headers })       – used by SalesforceBulkApiLoader
 *       → instance.get(path, config?)
 *       → instance.post(path, data?, config?)
 *       → instance.put(path, data?, config?)
 *       → instance.patch(path, data?, config?)
 *
 * Replaces the real axios so the browser bundle never references Node.js
 * http / https modules.
 */

/** Build the full URL, appending query-string params when provided. */
function buildUrl(base, path, params) {
  const url = base ? base.replace(/\/$/, '') + '/' + (path || '').replace(/^\//, '') : path;
  if (!params || Object.keys(params).length === 0) return url;
  return url + '?' + new URLSearchParams(params).toString();
}

/** Determine the fetch body and any extra headers needed for the payload. */
function encodeBody(data, extraHeaders) {
  if (data == null) return { body: undefined, headers: {} };

  const contentType = (extraHeaders || {})['Content-Type'] || '';

  // Pass CSV strings through as-is
  if (typeof data === 'string') {
    return { body: data, headers: {} };
  }

  // JSON object (default)
  return { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } };
}

/** Parse the response body, honouring the Accept header. */
async function parseResponse(response, acceptHeader) {
  if (acceptHeader && acceptHeader.toLowerCase().includes('text/csv')) {
    return response.text();
  }
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}

/** Throw an axios-compatible error (has .response.data / .response.status). */
async function throwForStatus(response, acceptHeader) {
  if (response.ok) return;
  let data;
  try { data = await parseResponse(response, acceptHeader); } catch { data = response.statusText; }
  const err = new Error(`Request failed with status code ${response.status}`);
  err.response = { status: response.status, data };
  throw err;
}

/** Core fetch wrapper used by all methods. */
async function request(method, url, data, config = {}) {
  const { extraHeaders, params, accept } = {
    extraHeaders: (config.headers || {}),
    params: config.params,
    accept: (config.headers || {})['Accept'],
  };

  const { body, headers: bodyHeaders } = encodeBody(data, extraHeaders);

  const mergedHeaders = { ...bodyHeaders, ...extraHeaders };

  const response = await fetch(buildUrl('', url, params), {
    method,
    headers: mergedHeaders,
    body,
  });

  await throwForStatus(response, accept || mergedHeaders['Accept']);
  const responseData = await parseResponse(response, accept || mergedHeaders['Accept']);
  return { data: responseData, status: response.status, headers: Object.fromEntries(response.headers) };
}

/** Create an axios-like instance pre-configured with baseURL and default headers. */
function create({ baseURL = '', headers: defaultHeaders = {} } = {}) {
  function makeRequest(method, path, data, config = {}) {
    const mergedConfig = {
      ...config,
      headers: { ...defaultHeaders, ...(config.headers || {}) },
    };
    const fullUrl = buildUrl(baseURL, path, mergedConfig.params);
    // Remove params from config so buildUrl inside request() doesn't double-append them
    const { params: _p, ...rest } = mergedConfig;
    return request(method, fullUrl, data, rest);
  }

  /**
   * axiosInstance.request({ url, method, data, headers, params })
   * Used by SalesforceApiLoader for the sObject Collections API.
   */
  function requestMethod({ url = '', method = 'GET', data, headers, params } = {}) {
    return makeRequest(method.toUpperCase(), url, data, { headers, params });
  }

  return {
    get:     (path, config)        => makeRequest('GET',    path, undefined, config),
    post:    (path, data, config)  => makeRequest('POST',   path, data,      config),
    put:     (path, data, config)  => makeRequest('PUT',    path, data,      config),
    patch:   (path, data, config)  => makeRequest('PATCH',  path, data,      config),
    delete:  (path, config)        => makeRequest('DELETE', path, undefined, config),
    request: requestMethod,
  };
}

/** Top-level axios.post used by SalesforceAuthenticator (client credentials). */
async function post(url, data, config = {}) {
  return request('POST', url, data, config);
}

const axios = { create, post };
export default axios;
export { create, post };
