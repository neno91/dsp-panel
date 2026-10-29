# DSP Panel

Touch-panel UI for a zoned audio system driven by an **Extron DMP 128** DSP
(the DMP 64 and the rest of the DMP family speak the same SIS command set –
just register fewer inputs/outputs in `/admin`):
zones with source selection and volume, a mixer for the inputs, zone and
source groups. Runs in any browser or phone and **publishes itself to Crestron
touch screens (TSW-1070, TS-770 and other x70 panels)** – no Crestron
processor or SIMPL program involved.

```
panel (HTML/JS)  ──WebSocket──▶  bridge (Node.js)  ──SIS/telnet──▶  Extron DMP 128
```

The DSP is the single source of truth: every button state and fader position
is what the DSP reports, so several panels, phones and the DSP's own software
always agree. Everything – DSP address, inputs, outputs, groups, screens,
logo and colours – is configured on the bridge's `/admin` page.

## Layout

```
dsp-panel/
├── index.html, css/, js/, assets/   the panel (plain HTML/CSS/JS, no framework; texts in js/i18n.js – nb/en)
│   └── js/config.js                 default config for opening index.html directly (simulation)
└── bridge/
    ├── server.js                    the bridge: DSP link, WebSocket, panel files, /admin, publishing
    ├── site.default.json            shipped defaults → copied to site.json on first start
    ├── site.json                    live configuration (edit via /admin; not in git – holds passwords/tokens)
    ├── admin/index.html             the /admin page
    └── tools/                       deploy-pi.sh, install-pi.sh, build-panel.js, fake-dmp.js, probe-dmp.js
```

## Run

```bash
cd bridge && npm install
npm start                       # http://<host>:3000  (panel · /admin · /ws)
```

Needs Node 18+. `bridge/site.json` is created from `site.default.json` on
first start; set the DSP address in `/admin`. On first start the bridge also
generates an access token and prints a warning until an admin password is
set – do that first (see *Access*).

**Raspberry Pi** (the intended host; give it a fixed IP and a cable):

```bash
bash bridge/tools/deploy-pi.sh pi@<pi-host>     # from your machine: copies the project, installs
                                                # Node/npm deps, (re)starts the dsp-panel service
ssh pi@<pi-host> journalctl -u dsp-panel -f     # logs
```

Re-run the same command to upgrade; the Pi's `site.json` is kept.

**Without a DSP** (development): `npm run fake-dmp` in one terminal, `npm run dev`
in another – an emulated DMP 128 on port 2323. Opening `index.html` directly
in a browser runs the UI against a built-in simulator.

## /admin

Everything is configured on `http://<host>:3000/admin`; saving validates,
writes `site.json`, re-reads the DSP and reloads every open panel.

| Section | What |
|---|---|
| DSP connection | IP, port, password, keepalive/timeouts, command pacing, reconnect |
| Control | direct block control (default) or DMP groups; block numbers; fader dB ranges |
| Site and panel | name, volume step, panel language (English / Norwegian, overridable per screen; the admin page has its own language switch in the header, English by default), admin password, bridge address as seen from the screens, token requirement |
| Appearance | logo and background image (uploaded, stored in `bridge/data/`, bundled into the `.ch5z`), logo height, background darkening, the complete colour palette (14 colours, with presets) – edits show live in the preview, *Save* applies them everywhere |
| Sources | one row per DSP input: name, input number, icon, optional label (mixer tag) |
| Zones | one row per DSP output: name, output number, icon, hint |
| Zone groups | zone groups shown on the panel (users can also make their own) |
| Source groups | *only one at a time* (Music 1/2/3 – selecting one switches the others off) or *toggle together* (one button per zone, e.g. All microphones) |
| Screens and access | the touch screens and browser accesses – see below |

Backup/restore: *Download configuration* / *Upload configuration* (whole
`site.json`).

### Screens, access and publishing

Each row under **Screens and access** is a screen *and* an access:

* **Zones / views** – which zones and which views (Zones, Mixer) that screen
  shows. Zone groups are filtered accordingly.
* **Scale** – magnification of the whole UI on that screen (1.3 suits the
  7″ TS-770, 1.0–1.2 the 10″ TSW-1070).
* **Access key** – a GUID. With *Require access key* on (default), the
  panel, its files, `/api/state` and the WebSocket all require a screen's
  token. Browsers open the link from *Copy link*
  (`http://<bridge>:3000/?token=…`) once; it is kept in a cookie. A row
  without an IP is simply a browser/phone access. *New key* revokes the old
  one. `/admin` itself is protected by the admin password (required while
  tokens are on).
* **Publish** – for rows with an IP (Crestron TSW-1070 / TS-770): the bridge
  builds a `.ch5z` with that screen's config (zones, views, scale, bridge
  WebSocket URL with the token baked in) using Crestron's `ch5-cli` and
  deploys it to the panel over SFTP with the saved login. Progress is shown
  on the page; ⬇ downloads the `.ch5z` for Crestron Toolbox if a direct deploy
  is not possible. The panel needs SSH enabled and only network access to the
  bridge. Re-publish after changing names, zones or inputs – browsers pick up
  changes by themselves.

`ch5-cli` is an npm dependency of the bridge (`npm install` fetches it).

Ports: screens/browsers → bridge **3000/tcp**; bridge → DSP **23/tcp**;
bridge → touch panels **22/tcp** (deploy); your machine → Pi 22/tcp.
The bridge speaks plain HTTP – tokens travel in clear on the LAN; put it
behind a TLS reverse proxy if the network is not trusted.

## How the bridge controls the DSP

Direct mode (default) addresses DMP 128 blocks by object id; the DSP is put in
verbose mode 3 so it reports every change, whoever made it.

| | Panel join | DSP object |
|---|---|---|
| Source with input *n* | mute D(20+n), level A(20+n) | mute `400(n−1)`, gain `401(n−1)` |
| Zone with output *o* | mute D(30+o), volume A(30+o) | output `600(o−1)` |
| Route source *n* → zone *o* | D(100 + (o−1)·10 + n−1) | mixpoint `2(n−1)(o−1)` mute (0 = on) |
| Views Zones / Mixer | D7 / D8 | – |

Gains are sent in tenths of dB with the +2048 offset, scaled between the dB
ranges set under *Control*. *DMP groups* mode uses DSP groups instead
(`advanced.groupsFallback` in `site.json`). One command is in flight at a time
with a configurable gap; user actions go ahead of queued state reads.

WebSocket protocol (JSON, both directions): `{"t":"b"|"n","j":<join>,"v":<value>}`;
`{"t":"sys","dsp":bool}` link state; `{"t":"sys","reload":true}` config changed.

## Useful endpoints

| | |
|---|---|
| `/api/health` | `{ok, dsp}` (more with a token) |
| `/api/state` | all joins (token) |
| `/api/export/config.js?panel=<id>` | a screen's generated config (admin) |
| `/api/admin/export/site.json` · `POST /api/admin/import` | backup / restore (admin) |
| `POST /api/admin/publish` · `/api/admin/publish/status` | publish job (admin) |
| `/api/admin/panels/<id>/archive` | that screen's `.ch5z` (admin) |
| `POST /api/admin/theme/upload?kind=logo\|background` · `POST /api/admin/theme/reset?kind=…[&none=1]` | appearance images (admin; body = the image, content-type image/png, jpeg, svg+xml or webp, ≤ 8 MB) |

Environment overrides: `PORT`, `DSP_HOST`, `DSP_PORT`, `DSP_PASSWORD`
(never written to `site.json`), `DSP_DEBUG=1` (log all DSP traffic),
`BUILD_DIR`.

## Licence

MIT with an attribution clause – see [LICENSE](LICENSE). Free to use, modify
and sell, including in commercial installations, as long as the
"Powered by DSP Panel" notice in the admin page stays visible and your
documentation says the product is based on DSP Panel.
