# Cookidoo for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that brings a
[Cookidoo](https://cookidoo.international) account — the recipe service of the **Thermomix** —
into Gladys: the shopping list and the week plan as sensors, dashboard widgets and scene actions.

> **Developed without the hardware nor an account: feedback welcome.** The integration follows
> the protocol of [cookidoo-api](https://github.com/miaucl/cookidoo-api), the library behind the
> Home Assistant integration, and is tested against its recorded answers — not against a real
> Cookidoo account yet. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-cookidoo/issues).
>
> Not affiliated with Vorwerk. Cookidoo and Thermomix are trademarks of Vorwerk.

## Features

- **Shopping list**: the ingredients of the recipes added to the list and the free items, checked
  or not; counters of the items to buy and checked, and the list as a text (for a message).
- **Week plan**: the recipes planned today (names, total time, count).
- **Subscription**: type (Premium, trial, free), end date and days left.
- **Scene actions**: _Add to the Cookidoo list_ ("Add milk" from a button or a voice command),
  _Check_ and _Uncheck a Cookidoo item_ by name, _Clear the checked Cookidoo items_.
- **Dashboard widgets**: the shopping list with buttons to add, check, uncheck and clear (each
  opens a short form), and the recipe of the day with its picture and a link to Cookidoo.
- **Configuration**: a _Test the connection_ button that signs in and says what it read.

No scene trigger: the counts and the recipe of the day are device features a scene condition
reads.

## Requirements

- Gladys Assistant **5.2.0** or later (widget buttons opening a form, GladysAssistant/Gladys#3168).
- A Cookidoo account signing in with an e-mail and a password (any country Cookidoo serves).
- Internet access from Gladys (cloud service).

## Installation

In Gladys: **Integrations → Install from GitHub**, with the URL of this repository. Fill in the
e-mail, the password and the country of the account, then add the **Cookidoo** device from the
**Discover** tab. The user documentation is in [docs/](docs/en.md) (English, French, German,
Spanish) and is shown by Gladys from the Configuration screen.

## How it works

- **Sign-in**: OAuth2 authorization code + PKCE against the Vorwerk identity provider (the public
  client of the Cookidoo app, no secret embedded), then 12-hour access tokens renewed with the
  refresh token. The tokens and the profile id live in `/data/cookidoo.json` (mode 600); the
  password stays in the Gladys configuration.
- **Endpoints**: read from Cookidoo's own `.well-known/home` documents, never hard-coded.
- **Refresh**: the container's own timer (the core does not poll external devices reliably,
  Gladys#3198), every 5 minutes by default, only while the device is added or a widget is shown:
  two requests per refresh, the subscription every 6 hours. States are published only when they
  change, plus a heartbeat every 6 hours.
- **No workaround**: the requests carry the integration's own User-Agent. A refusal of the
  anti-robot protection pauses the integration for 30 minutes; a refused password stops the
  automatic sign-in until the configuration changes or the user tests the connection.

## Limits

- Unofficial, undocumented API: Cookidoo can change it at any time.
- Changes made in the Cookidoo app show after the next refresh (5 minutes by default).
- Only free items can be added; Cookidoo removes an ingredient with its recipe only.
- No control of the Thermomix, no recipe search, no planning from Gladys; one account per
  integration.

## Development

```bash
npm install
npm test                       # node --test, against the SDK's fake Gladys and a fake Cookidoo
npm run lint
npm run format:check
node scripts/probe.mjs fr      # the real service, a made-up account, read-only
```

`scripts/probe.mjs` runs the real sign-in with a made-up account until Cookidoo refuses it, and
the public endpoint discovery, printing hosts, paths and statuses only. With `COOKIDOO_EMAIL` and
`COOKIDOO_PASSWORD` set, it reads a real account (counts only, read-only). On Node 24 behind a
proxy, add `NODE_USE_ENV_PROXY=1`.

Releases are made by the Release workflow (Actions → Release); see [CLAUDE.md](CLAUDE.md) for the
project rules.

## Credits

- [cookidoo-api](https://github.com/miaucl/cookidoo-api) by Cyrill Raccaud (miaucl), MIT: the
  protocol (OAuth flow, endpoint discovery, shopping list and planning calls), the country table
  (`src/cookidoo/markets.json`) and the recorded answers used as test fixtures
  (`test/fixtures/cookidoo/`).
- The [Home Assistant Cookidoo integration](https://www.home-assistant.io/integrations/cookidoo)
  (Apache-2.0), for the account identity and the subscription mapping.
- Built on the official [integration template](https://github.com/GladysAssistant/integration-template-js)
  and [SDK](https://github.com/GladysAssistant/integration-sdk-js) of Gladys Assistant.

## License

[Apache-2.0](LICENSE).
