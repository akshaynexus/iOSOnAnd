// GET /api/docs — live endpoint list. auth: public = no login, login = session
// cookie or `Authorization: Bearer <tracker-token>`, admin = admin account.

import { createFileRoute } from '@tanstack/react-router';

const ENDPOINTS = [
  { method: 'GET', path: '/api/docs', auth: 'public', desc: 'this list' },
  { method: 'GET', path: '/api/areas', auth: 'public', desc: 'checklist areas (?q not needed; full list)' },
  { method: 'POST', path: '/api/areas', auth: 'login', desc: 'add an area {slug,name,notes?}' },
  { method: 'GET', path: '/api/devices?q=&state=&limit=', auth: 'public', desc: 'device list' },
  { method: 'POST', path: '/api/devices', auth: 'login', desc: 'add a device' },
  { method: 'GET', path: '/api/devices/:slug', auth: 'public', desc: 'detail with statuses+forks+claims+posts nested' },
  { method: 'PATCH', path: '/api/devices/:slug', auth: 'login', desc: 'update a device' },
  { method: 'DELETE', path: '/api/devices/:slug', auth: 'admin', desc: 'remove a device' },
  { method: 'GET', path: '/api/status?device=&area=&state=', auth: 'public', desc: 'per-area states' },
  { method: 'PUT', path: '/api/status', auth: 'login', desc: 'upsert one cell {device|device_slug,area|area_slug,state,detail?,source?}' },
  { method: 'GET', path: '/api/status/:device/:area', auth: 'public', desc: 'one cell' },
  { method: 'PUT', path: '/api/status/:device/:area', auth: 'login', desc: 'upsert one cell {state,detail?,source?}' },
  { method: 'GET', path: '/api/forks?device=', auth: 'public', desc: 'fork list' },
  { method: 'POST', path: '/api/forks', auth: 'login', desc: 'add a fork' },
  { method: 'POST', path: '/api/forks/sync', auth: 'login', desc: 'upsert a fork by repo' },
  { method: 'GET', path: '/api/forks/:id', auth: 'public', desc: 'one fork' },
  { method: 'PATCH', path: '/api/forks/:id', auth: 'login', desc: 'update a fork' },
  { method: 'DELETE', path: '/api/forks/:id', auth: 'admin', desc: 'remove a fork' },
  { method: 'GET', path: '/api/posts?limit=', auth: 'public', desc: 'updates list' },
  { method: 'POST', path: '/api/posts', auth: 'login', desc: 'add a post {title,url,published?,note?}' },
  { method: 'GET', path: '/api/posts/:id', auth: 'public', desc: 'one post' },
  { method: 'PATCH', path: '/api/posts/:id', auth: 'login', desc: 'update a post' },
  { method: 'DELETE', path: '/api/posts/:id', auth: 'admin', desc: 'remove a post' },
  { method: 'POST', path: '/api/reddit/fetch', auth: 'login', desc: 'fetch r/<subreddit> candidates {subreddit?}' },
  { method: 'GET', path: '/api/claims?device=&status=', auth: 'public', desc: 'claims' },
  { method: 'POST', path: '/api/claims', auth: 'login', desc: 'file a claim {device_slug,note?}' },
  { method: 'GET', path: '/api/claims/:id', auth: 'public', desc: 'one claim' },
  { method: 'PATCH', path: '/api/claims/:id', auth: 'admin', desc: 'set status {status}' },
  { method: 'DELETE', path: '/api/claims/:id', auth: 'login', desc: 'withdraw own pending claim (admin: any)' },
  { method: 'POST', path: '/api/claims/:id/approve', auth: 'admin', desc: 'approve a pending claim' },
  { method: 'POST', path: '/api/claims/:id/reject', auth: 'admin', desc: 'reject a pending claim' },
  { method: 'GET', path: '/api/changelog?limit=', auth: 'public', desc: 'write feed' },
  { method: 'GET', path: '/api/search?q=', auth: 'public', desc: 'search devices+forks+posts' },
  { method: 'POST', path: '/api/auth/signup', auth: 'public', desc: 'email signup (alias: /api/auth/register)' },
  { method: 'POST', path: '/api/auth/register', auth: 'public', desc: 'email signup' },
  { method: 'POST', path: '/api/auth/login', auth: 'public', desc: 'email login' },
  { method: 'POST', path: '/api/auth/logout', auth: 'public', desc: 'end session' },
  { method: 'GET', path: '/api/auth/me', auth: 'login', desc: 'current user' },
  { method: 'GET', path: '/api/auth/tokens', auth: 'login', desc: 'list my tracker tokens' },
  { method: 'POST', path: '/api/auth/tokens', auth: 'login', desc: 'mint a token {name?,expires_days?}' },
  { method: 'DELETE', path: '/api/auth/tokens', auth: 'login', desc: 'revoke {?id=} or {id} or {token}' },
  { method: 'POST', path: '/api/auth/gh-challenge', auth: 'public', desc: 'gist-proof nonce {github_login|github_id}' },
  { method: 'POST', path: '/api/auth/gh-verify', auth: 'public', desc: 'gist-proof login {gist_url,nonce?,github_login?}' },
  { method: 'POST', path: '/api/auth/link', auth: 'public', desc: 'bind github to email account {email,password,gist_url,...} (409 on dup)' },
  { method: 'POST', path: '/api/auth/gh-link', auth: 'login', desc: 'link github via gist {gist_id} (409 on dup)' },
  { method: 'DELETE', path: '/api/auth/gh-link', auth: 'login', desc: 'unlink github' },
  { method: 'POST', path: '/api/auth/unlink', auth: 'login', desc: 'unlink github (UI shape)' },
  { method: 'GET,POST', path: '/api/auth/token-check', auth: 'public', desc: 'verify tracker token or exchange a github token {token}' },
  { method: 'GET', path: '/api/tokens', auth: 'login', desc: 'list my tracker tokens (UI shape)' },
  { method: 'POST', path: '/api/tokens', auth: 'login', desc: 'mint {name?} -> {token,record} (UI shape)' },
  { method: 'DELETE', path: '/api/tokens/:id', auth: 'login', desc: 'revoke one token (UI shape)' },
  { method: 'POST', path: '/api/users', auth: 'admin', desc: 'create an account {email,password,is_admin?}' },
];

export const Route = createFileRoute('/api/docs')({
  server: {
    handlers: {
  GET: async () =>
    new Response(JSON.stringify({ endpoints: ENDPOINTS }), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }),
    },
  },
});
