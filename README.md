# dmarc-email-worker

A Cloudflare worker script to process incoming DMARC reports, and send them to Splunk

It makes use of:

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Email Workers](https://developers.cloudflare.com/email-routing/email-workers/)
- [Splunk](https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector)

More details about the original on the [blog post](https://blog.cloudflare.com/how-we-built-dmarc-management/).

## Install instructions

1. Clone this repo
1. Install dependencies with `npm install`
1. Login to your Cloudflare account with `npx wrangler login`
1. Ensure that HEC URL and HEC token are correct in `wrangler.toml`
1. Run `npx wrangler publish` to publish the worker
1. Configure an Email Routing rule to forward the email from a destinattion address to this worker `dmarc-email-worker`
1. Add this address as RUA to your domain's DMARC record
