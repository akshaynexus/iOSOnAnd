// src/lib/mail.ts — outgoing mail through Cloudflare Email Service (the
// `send_email` binding EMAIL in wrangler.jsonc). No API key and no other
// vendor: 3,000 mails a month come with the Workers Paid plan.
//
// - Local dev (vite dev / wrangler dev) simulates the binding: the mail is
//   printed in the dev server console and not sent.
// - Deploy: onboard the sending domain (dashboard: Email Service > Email
//   Sending), then `wrangler secret put MAIL_FROM` (e.g. noreply@yourdomain).
// - No binding: the mail is printed in the console when the request came to
//   localhost, and dropped with an error log otherwise.

import { env as cfEnv } from 'cloudflare:workers';
import { env } from '@/lib/auth';

interface MailBinding {
  send(msg: { to: string; from: string | { email: string; name: string }; subject: string; text: string; html?: string }): Promise<{ messageId: string }>;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function isLocalUrl(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Send one mail. Returns false when it could not be handed to the mail service. */
export async function sendMail(mail: Mail, requestUrl: string): Promise<boolean> {
  const binding = (cfEnv as unknown as { EMAIL?: MailBinding }).EMAIL;
  const from = env('MAIL_FROM') || 'noreply@iosonand.local';
  if (!binding || typeof binding.send !== 'function') {
    if (isLocalUrl(requestUrl)) {
      console.log(`mail (not sent, no EMAIL binding) to ${mail.to}: ${mail.subject}\n${mail.text}`);
      return true;
    }
    console.error('mail not sent: the EMAIL send_email binding is missing (wrangler.jsonc)');
    return false;
  }
  try {
    await binding.send({ to: mail.to, from: { email: from, name: 'iOSOnAnd' }, subject: mail.subject, text: mail.text, html: mail.html });
    return true;
  } catch (e) {
    const code = (e as { code?: string }).code;
    console.error(`mail failed${code ? ` (${code})` : ''}:`, e); // no address in production logs
    return false;
  }
}
