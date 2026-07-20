import axios from 'axios';
import { env } from '../config/env';
import { appendUtmToAllLinks } from '../utils/utm';
import { renderBrandedEmail } from '../services/emailTemplate';
import { EmailProvider, EmailSendResult } from './types';

// ActiveCampaign adapter (EmailProvider). v3 API, api-token header.
// The worker queue that drives this adapter is rate-limited to 5 req/s
// (CLAUDE.md rule 3) — configured on the BullMQ Worker, not here.
// Emails render through the client's branded newsletter template
// (emailTemplate.ts) — generated copy in the intro, post + lead magnet as CTA
// panels, Daryn's sign-off and the CASL footer preserved.

export class ActiveCampaignAdapter implements EmailProvider {
  readonly name = 'activecampaign';

  async createAndSendCampaign(input: {
    subject: string;
    body: string;
    campaignSlug: string;
    postTitle?: string;
    postExcerpt?: string;
    liveUrl?: string | null;
    leadMagnetUrl?: string | null;
    magnetName?: string | null;
  }): Promise<EmailSendResult> {
    // UTM enforcement at publish time (rule 8): rewrite every link in the body;
    // the template UTM-tags its own CTA buttons.
    const bodyWithUtm = appendUtmToAllLinks(input.body, 'activecampaign', input.campaignSlug);
    const html = renderBrandedEmail({
      subject: input.subject,
      body: bodyWithUtm,
      campaignSlug: input.campaignSlug,
      postTitle: input.postTitle ?? '',
      postExcerpt: input.postExcerpt ?? '',
      liveUrl: input.liveUrl ?? null,
      leadMagnetUrl: input.leadMagnetUrl ?? null,
      magnetName: input.magnetName ?? null
    });

    if (!env.activeCampaign.apiKey) {
      console.info('[activecampaign:stub] would send', {
        subject: input.subject,
        listId: env.activeCampaign.listId,
        htmlBytes: html.length
      });
      return { campaignId: `cmp_stub_${Date.now().toString().slice(-6)}`, recipientCount: 0 };
    }

    const api = axios.create({
      baseURL: env.activeCampaign.apiUrl,
      headers: { 'Api-Token': env.activeCampaign.apiKey, 'Content-Type': 'application/json' },
      timeout: 20_000
    });

    // 1) Create the message (email content).
    const message = await api.post('/api/3/messages', {
      message: {
        fromemail: env.activeCampaign.fromEmail,
        fromname: env.activeCampaign.fromName,
        subject: input.subject,
        html
      }
    });

    // 2) Create + send the campaign to the subscriber list (new ad leads flow
    //    into the same list via the sign-up form automation).
    const campaign = await api.post('/api/3/campaigns', {
      campaign: {
        type: 'single',
        name: `propago-${input.campaignSlug}`,
        status: 1, // 1 = scheduled/sending now
        public: 0,
        sdate: new Date().toISOString(),
        p: { [env.activeCampaign.listId]: env.activeCampaign.listId },
        m: { [message.data.message.id]: 100 }
      }
    });

    return {
      campaignId: String(campaign.data.campaign?.id ?? campaign.data.id),
      recipientCount: parseInt(campaign.data.campaign?.send_amt ?? '0', 10)
    };
  }
}
