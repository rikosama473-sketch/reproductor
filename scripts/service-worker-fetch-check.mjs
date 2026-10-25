import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
assert.match(source, /"\.\/src\/id3-tags\.js"/, "The MP3 metadata module must be cached for offline startup");
assert.match(source, /"\.\/src\/audio-converter\.js"/, "The audio converter module must be cached for offline startup");
assert.match(source, /"\.\/src\/concurrent-map\.js"/, "The bounded metadata worker module must be cached for offline startup");
const scopeUrl = "https://example.test/app/sw.js";
const shellUrl = "https://example.test/app/index.html";

function createHarness({ network } = {}) {
  const handlers = new Map();
  const entries = new Map();
  const trace = [];
  const waits = [];
  const keyFor = request => new URL(typeof request === "string" ? request : request.url, scopeUrl).href;
  const caches = {
    async match(request) {
      const key = keyFor(request);
      trace.push("cache-match:" + new URL(key).pathname);
      const response = entries.get(key);
      return response ? response.clone() : undefined;
    },
    async open(name) {
      trace.push("cache-open:" + name);
      return {
        async addAll() {},
        async put(request, response) {
          const key = keyFor(request);
          trace.push("cache-put:" + new URL(key).pathname);
          entries.set(key, response.clone());
        }
      };
    },
    async keys() { return ["ritmo-shell-v14"]; },
    async delete() { return true; }
  };
  const self = {
    location: { origin: "https://example.test", href: scopeUrl },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener(name, handler) { handlers.set(name, handler); }
  };
  const context = vm.createContext({
    self, caches, URL, Response, Error,
    fetch: async request => {
      trace.push("network:" + new URL(request.url).pathname);
      if (!network) throw new Error("simulated offline");
      return network(request);
    }
  });
  vm.runInContext(source, context, { filename: "sw.js" });
  return {
    entries, trace, waits,
    async runFetch(request) {
      let responsePromise;
      handlers.get("fetch")({
        request,
        respondWith(promise) { responsePromise = promise; },
        waitUntil(promise) { waits.push(Promise.resolve(promise)); }
      });
      assert.ok(responsePromise, "same-origin GET should be intercepted");
      const response = await responsePromise;
      await Promise.all(waits.splice(0));
      return response;
    },
    cache(url, body) { entries.set(keyFor(url), new Response(body, { status: 200 })); }
  };
}

function request(url, { mode = "no-cors", destination = "image", method = "GET" } = {}) {
  return { url, method, mode, destination };
}

// Regression 1: a stale cached document must not mask a newer network response.
{
  const app = createHarness({ network: async () => new Response("fresh-document", { status: 200 }) });
  app.cache(shellUrl, "stale-document");
  const response = await app.runFetch(request(shellUrl, { mode: "navigate", destination: "document" }));
  assert.equal(await response.text(), "fresh-document");
  assert.equal(app.trace[0], "network:/app/index.html", "navigation should consult the network before the cache");
  assert.ok(app.trace.includes("cache-put:/app/index.html"), "successful navigation response should refresh the cache");
  assert.equal(await (await app.entries.get(shellUrl).clone()).text(), "fresh-document");
}

// Regression 2: unversioned JavaScript and styles must receive the same freshness guarantee.
{
  const scriptUrl = "https://example.test/app/src/app.js";
  const app = createHarness({ network: async () => new Response("fresh-script", { status: 200 }) });
  app.cache(scriptUrl, "stale-script");
  const response = await app.runFetch(request(scriptUrl, { destination: "script" }));
  assert.equal(await response.text(), "fresh-script");
  assert.equal(app.trace[0], "network:/app/src/app.js", "unversioned scripts should try the network before a stale cache entry");
}

// Regression 3: when network-first requests fail, use the cached response if present.
{
  const app = createHarness();
  app.cache(shellUrl, "offline-document");
  const response = await app.runFetch(request(shellUrl, { mode: "navigate", destination: "document" }));
  assert.equal(await response.text(), "offline-document");
  assert.equal(app.trace[0], "network:/app/index.html");
  assert.ok(app.trace.some(item => item === "cache-match:/app/index.html"));
}

// Regression 4: a deep link can fall back to the cached app shell while offline.
{
  const deepLink = "https://example.test/app/library/offline";
  const app = createHarness();
  app.cache(shellUrl, "offline-shell");
  const response = await app.runFetch(request(deepLink, { mode: "navigate", destination: "document" }));
  assert.equal(await response.text(), "offline-shell");
}

// Images remain cache-first to avoid unnecessary network work for cached artwork/icons.
{
  const iconUrl = "https://example.test/app/assets/icon.svg";
  const app = createHarness({ network: async () => new Response("fresh-icon", { status: 200 }) });
  app.cache(iconUrl, "cached-icon");
  const response = await app.runFetch(request(iconUrl, { destination: "image" }));
  assert.equal(await response.text(), "cached-icon");
  assert.ok(app.trace[0].startsWith("cache-match:"), "image resources should remain cache-first");
}

// Regression: an HTTP 404 for a cached script must not send HTML/error text to the JS loader.
{
  const scriptUrl = "https://example.test/app/src/app.js";
  const app = createHarness({ network: async () => new Response("not-found-html", { status: 404 }) });
  app.cache(scriptUrl, "known-good-script");
  const response = await app.runFetch(request(scriptUrl, { destination: "script" }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "known-good-script");
  assert.ok(app.trace.includes("cache-match:/app/src/app.js"));
}

// Regression: a server error during a deployment uses the cached document shell.
{
  const app = createHarness({ network: async () => new Response("deployment-in-progress", { status: 503 }) });
  app.cache(shellUrl, "last-known-good-shell");
  const response = await app.runFetch(request(shellUrl, { mode: "navigate", destination: "document" }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "last-known-good-shell");
}

// Auth/permission errors are not treated as transient deployment failures.
{
  const scriptUrl = "https://example.test/app/src/app.js";
  const app = createHarness({ network: async () => new Response("forbidden", { status: 403 }) });
  app.cache(scriptUrl, "old-script");
  const response = await app.runFetch(request(scriptUrl, { destination: "script" }));
  assert.equal(response.status, 403);
}
console.log("Service-worker tests passed: freshness, offline fallback, deployment 404/5xx recovery and cache-first images.");
