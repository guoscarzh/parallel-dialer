# Parallel Dialer

A parallel dialer for SDRs. Three voice agents call three leads at the same time. Whoever picks up is instantly transferred to the SDR, and calls that hit voicemail get a prerecorded, human-made voicemail from the SDR.

- **Leads:** ScraperCity (ICP to verified phone numbers)
- **Telephony:** TBD (Twilio planned)

## Setup

1. `npm install`
2. `cp .env.example .env.local` and fill in your Twilio credentials.
3. `cp data/leads.example.csv data/leads.csv` and put in your test numbers. On a Twilio trial, every number must be a Verified Caller ID.
4. Optional: put your voicemail at `public/voicemail.mp3`. Without it, a text-to-speech placeholder plays.
5. `ngrok config add-authtoken <token>` once, then `ngrok http 3000`. Set `PUBLIC_URL` in `.env.local` to the https URL ngrok prints.
6. `npm run dev`, open http://localhost:3000, click **Go online**, then **Dial next 3**.

## How it works

- `POST /api/dial` places 3 Twilio calls with async answering machine detection set to `DetectMessageEnd`.
- `/api/twilio/amd`: the first human is bridged to the browser softphone (`<Client>sdr</Client>`) and the other lines are hung up. A machine gets the voicemail after the beep.
- Leads come from `lib/leads/` (`LEAD_SOURCE=csv` now, `scrapercity` once the API key arrives).
- State is kept in memory (one local process), and the dashboard polls `/api/state`.
