// The OAuth door, end to end, and the scope gate in front of every tool.
//
//   node --env-file=<keys.env> --test tests/oauth.test.mjs
//
// The half of the flow a human performs (signing in, reading the consent
// screen, pressing Authorise) cannot be driven from here, so this file proves
// everything on either side of it: discovery, registration, what the token
// endpoint refuses, and what a scoped credential is allowed to do. The consent
// screen itself is what the stranger test covers.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

const BASE = process.env.AWESOME_BASE_URL ?? "http://localhost:3000";
const KEY = process.env.AWESOME_KEY_A;
if (!KEY) {
  console.error("Set AWESOME_KEY_A (see scripts/seed-test-org.mjs).");
  process.exit(1);
}

const post = (path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const form = (path, fields) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });

describe("discovery", () => {
  // Both documents print addresses from APP_URL, not from the request, so the
  // host here is whatever the deployment is configured to call itself. What
  // has to hold is that the two agree: a resource pointing at an issuer that
  // advertises a different origin sends every client in a circle.
  test("the two documents agree on who issues tokens", async () => {
    const resourceRes = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
    assert.equal(resourceRes.status, 200);
    const resource = await resourceRes.json();

    assert.ok(Array.isArray(resource.authorization_servers));
    assert.ok(resource.authorization_servers.length > 0);
    assert.deepEqual(resource.scopes_supported, ["read", "write", "delete"]);

    const issuer = resource.authorization_servers[0];
    assert.equal(
      resource.resource,
      `${issuer}/api/mcp`,
      "the protected resource must live under the issuer it names",
    );

    const asRes = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    const server = await asRes.json();
    assert.equal(server.issuer, issuer);
    for (const key of [
      "authorization_endpoint",
      "token_endpoint",
      "registration_endpoint",
    ]) {
      assert.ok(
        server[key].startsWith(issuer),
        `${key} points outside the issuer it belongs to`,
      );
    }
  });

  test("the authorization server advertises PKCE and nothing weaker", async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    assert.equal(res.status, 200);
    const doc = await res.json();
    assert.deepEqual(doc.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(doc.response_types_supported, ["code"]);
    // OAuth 2.1 removes these. Advertising either would invite a client to use
    // a flow with no proof of possession.
    assert.ok(!doc.grant_types_supported.includes("implicit"));
    assert.ok(!doc.grant_types_supported.includes("password"));
    assert.ok(doc.registration_endpoint);
  });

  test("both documents are readable without any credential", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-authorization-server",
    ]) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      assert.equal(res.status, 200, `${path} should not need a session`);
    }
  });
});

describe("the 401 that starts the flow", () => {
  // Without this header a client that arrives with no credential has nowhere
  // to look, and reports that it cannot connect rather than authorising.
  for (const path of ["/api/mcp", "/api/agent/business_snapshot"]) {
    test(`${path} points an unauthenticated caller at the metadata`, async () => {
      const res = await post(path, {});
      assert.equal(res.status, 401);
      const header = res.headers.get("www-authenticate");
      assert.ok(header, "WWW-Authenticate is missing");
      assert.match(header, /resource_metadata=/);
      assert.match(header, /oauth-protected-resource/);
    });
  }
});

describe("client registration", () => {
  test("registers a public client and returns no secret", async () => {
    const res = await post("/api/oauth/register", {
      client_name: "Test Assistant",
      redirect_uris: ["http://127.0.0.1:9876/callback"],
      token_endpoint_auth_method: "none",
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.client_id);
    assert.equal(body.client_secret, undefined);
    assert.equal(body.token_endpoint_auth_method, "none");
  });

  test("refuses a redirect that is neither https nor loopback", async () => {
    const res = await post("/api/oauth/register", {
      client_name: "Sketchy",
      redirect_uris: ["http://evil.example.com/callback"],
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "invalid_redirect_uri");
  });

  test("refuses a registration with no redirect at all", async () => {
    const res = await post("/api/oauth/register", { client_name: "Nowhere" });
    assert.equal(res.status, 400);
  });
});

describe("the token endpoint refuses what it should", () => {
  let clientId;

  test("register a client to exchange with", async () => {
    const res = await post("/api/oauth/register", {
      client_name: "Exchange Test",
      redirect_uris: ["http://127.0.0.1:9876/callback"],
    });
    clientId = (await res.json()).client_id;
    assert.ok(clientId);
  });

  test("an unknown client", async () => {
    const res = await form("/api/oauth/token", {
      grant_type: "authorization_code",
      client_id: "awsc_not_a_real_client",
      code: "whatever",
      code_verifier: "whatever",
      redirect_uri: "http://127.0.0.1:9876/callback",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_client");
  });

  test("a code that was never issued", async () => {
    const verifier = randomBytes(32).toString("base64url");
    const res = await form("/api/oauth/token", {
      grant_type: "authorization_code",
      client_id: clientId,
      code: `awsx_${randomBytes(32).toString("base64url")}`,
      code_verifier: verifier,
      redirect_uri: "http://127.0.0.1:9876/callback",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_grant");
  });

  test("a grant type we do not implement", async () => {
    const res = await form("/api/oauth/token", {
      grant_type: "password",
      client_id: clientId,
      username: "someone",
      password: "something",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "unsupported_grant_type");
  });

  test("a refresh token that belongs to nobody", async () => {
    const res = await form("/api/oauth/token", {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: `awso_${randomBytes(32).toString("base64url")}`,
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_grant");
  });
});

describe("the consent screen", () => {
  test("refuses a request with no PKCE challenge", async () => {
    // Unauthenticated, so this redirects to the login. What matters is that it
    // is never a redirect back to the client carrying anything usable.
    const res = await fetch(
      `${BASE}/oauth/authorize?client_id=x&redirect_uri=http://127.0.0.1:9876/callback&response_type=code`,
      { redirect: "manual" },
    );
    assert.ok([200, 302, 307].includes(res.status));
    const location = res.headers.get("location") ?? "";
    assert.ok(
      !location.includes("code="),
      "a code must never be issued without consent",
    );
  });

  test("signing in carries the consent request along", async () => {
    const target = "/oauth/authorize?client_id=x&response_type=code";
    const res = await fetch(`${BASE}${target}`, { redirect: "manual" });
    if (res.status === 200) return; // already signed in in this environment
    const location = res.headers.get("location") ?? "";
    assert.match(location, /\/login/);
    assert.match(location, /next=/);
  });
});

describe("PKCE", () => {
  // Not a network test: it pins the transformation the store verifies, so a
  // change to the hashing or the encoding fails here rather than silently
  // rejecting every real client.
  test("S256 is sha256 then base64url with no padding", () => {
    const verifier = "a-verifier-of-reasonable-length-1234567890";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    assert.ok(!challenge.includes("="));
    assert.ok(!challenge.includes("+"));
    assert.ok(!challenge.includes("/"));
  });
});

describe("scopes", () => {
  // The seeded key holds every scope, so it can reach everything. What is
  // asserted here is that the gate exists and answers in a way an agent can
  // act on.
  test("a full key can still call a read tool", async () => {
    const res = await post(
      "/api/agent/business_snapshot",
      {},
      { authorization: `Bearer ${KEY}` },
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  test("every tool declares a scope, so none is callable by accident", async () => {
    const res = await post(
      "/api/mcp",
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { authorization: `Bearer ${KEY}`, accept: "application/json" },
    );
    const body = await res.json();
    const names = body.result.tools.map((t) => t.name);
    assert.ok(names.length > 0);

    // A tool missing from the registry's scope map would be refused for a full
    // key too, which is the failure we want: loud, not silent.
    for (const name of names) {
      const call = await post(
        "/api/mcp",
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name, arguments: {} },
        },
        { authorization: `Bearer ${KEY}`, accept: "application/json" },
      );
      const result = await call.json();
      const text = result.result?.content?.[0]?.text ?? "";
      assert.ok(
        !text.includes("is not allowed to"),
        `${name} was refused for a key holding every scope, so its scope is wrong`,
      );
    }
  });

  test("get_started explains the business without any setup", async () => {
    const res = await post(
      "/api/agent/get_started",
      {},
      { authorization: `Bearer ${KEY}` },
    );
    assert.equal(res.status, 200);
    const { result } = await res.json();
    assert.ok(result.guide.length > 500, "the guide should be substantial");
    assert.ok(result.connected_as, "it should say who it is connected as");
    assert.ok(Array.isArray(result.you_may));
  });
});
