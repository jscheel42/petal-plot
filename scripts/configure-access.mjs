// One-time Access app trim: the dashboard no longer exposes "allowed
// actions", so set them via API — anonymous GETs pass, writes are gated.
// Usage: CLOUDFLARE_API_TOKEN=<token with Access:Apps and Policies:Edit> node scripts/configure-access.mjs
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
	console.error('CLOUDFLARE_API_TOKEN env var required (Custom token → Account → Access: Apps and Policies → Edit)');
	process.exit(1);
}
const ACCT = 'a6c04dd5ad7cd6d21e455b45302109fb';
const DOMAIN = 'petal-plot.joshuascheel.com';

async function api(path, opts = {}) {
	const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
		...opts,
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(opts.headers ?? {}) }
	});
	const j = await r.json();
	if (!j.success) throw new Error(j.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${r.status}`);
	return j.result;
}

const apps = await api(`/accounts/${ACCT}/access/apps`);
const app = apps.find((a) => a.domain === DOMAIN);
if (!app) {
	console.error(`No Access app for ${DOMAIN} yet — create it in the dashboard first, then rerun.`);
	process.exit(1);
}
const full = await api(`/accounts/${ACCT}/access/apps/${app.app_id}`);
const body = { ...full };
delete body.id;
delete body.create_time;
body.allowed_actions = ['POST', 'PATCH', 'DELETE'];
const updated = await api(`/accounts/${ACCT}/access/apps/${app.app_id}`, { method: 'PUT', body: JSON.stringify(body) });
console.log('app:', updated.name, '| allowed_actions:', updated.allowed_actions.join(', '));
console.log('AUD tag:', updated.aud);
console.log('\nNext:');
console.log('  npx wrangler secret put ACCESS_AUD    # paste the AUD tag above');
console.log('  npx wrangler secret put ACCESS_TEAM   # your Zero Trust subdomain (dashboard URL, e.g. "joshuascheel")');
console.log('  npm run deploy:preview && npx wrangler versions deploy "<new-version-id>@100" -y');
