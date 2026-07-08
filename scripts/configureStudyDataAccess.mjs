const ACCOUNT_ID = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const API_TOKEN = requireEnv("CLOUDFLARE_API_TOKEN");
const POLICY_NAME = process.env.ACCESS_POLICY_NAME || "BCP管理者のみ";
const APP_NAME = "study.gohome-clinic.com data";
const DOMAINS = [
  "study.gohome-clinic.com/data*",
  "study.gohome-clinic.com/api/analytics/dashboard*",
];

const policy = await findPolicyByName(POLICY_NAME);
if (!policy) {
  throw new Error(`Access policy not found: ${POLICY_NAME}`);
}

const existing = await findExistingApplication();
const payload = {
  name: APP_NAME,
  type: "self_hosted",
  domain: DOMAINS[0],
  self_hosted_domains: DOMAINS,
  session_duration: "24h",
  auto_redirect_to_identity: false,
  allowed_idps: [],
  policies: [
    {
      id: policy.id,
      precedence: 1,
    },
  ],
};

let result;
if (existing) {
  result = await api("PUT", `/accounts/${ACCOUNT_ID}/access/apps/${existing.id}`, payload);
  console.log(`Access application updated: ${result.name}`);
} else {
  result = await api("POST", `/accounts/${ACCOUNT_ID}/access/apps`, payload);
  console.log(`Access application created: ${result.name}`);
}

console.log(`application_id=${result.id}`);
console.log(`domains=${(result.self_hosted_domains || [result.domain]).join(",")}`);
console.log(`policy=${policy.name}`);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function findPolicyByName(name) {
  const policies = await api("GET", `/accounts/${ACCOUNT_ID}/access/policies`);
  return policies.find((policy) => policy.name === name) || null;
}

async function findExistingApplication() {
  const apps = await api("GET", `/accounts/${ACCOUNT_ID}/access/apps`);
  return (
    apps.find((app) => {
      const domains = app.self_hosted_domains || (app.domain ? [app.domain] : []);
      return app.name === APP_NAME || DOMAINS.some((domain) => domains.includes(domain));
    }) || null
  );
}

async function api(method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok || json.success === false) {
    const errors = Array.isArray(json.errors)
      ? json.errors.map((error) => `${error.code || "error"}:${error.message || "unknown"}`).join("; ")
      : `HTTP ${response.status}`;
    throw new Error(`Cloudflare API failed (${method} ${path}): ${errors}`);
  }
  return json.result;
}
